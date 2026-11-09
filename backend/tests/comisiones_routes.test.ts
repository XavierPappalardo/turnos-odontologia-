/**
 * C-13, tasks 6.1/6.2 + 7.1/7.3: E2E de rutas y RBAC de comisiones con
 * SQLite REAL (supertest sobre `createApp`, sin mocks — R12).
 * - Flujo completo por HTTP: configurar → preview (captura fingerprint) →
 *   generar → regenerar tras anular un cobro → confirmar → listar/detalle.
 * - Errores por HTTP (task 6.2/status): `preview_desactualizado` (fp viejo,
 *   % cambiado, cobro anulado), `periodo_ya_liquidado`, `estado_invalido`,
 *   `cobro_ya_liquidado`, `sin_configuracion`, `validacion`, `not_found`,
 *   401/403 RBAC.
 * - Portal del profesional (Q6): scoping forzado por usuario.profesional_id,
 *   SOLO confirmadas; GET /:id propia confirmada / ajena u otra-estado → 404.
 * - Carrera de reserva de ajustes (7.3, P2/D13): DOS apps con DOS conexiones
 *   reales sobre BD compartida en FICHERO, sin sleeps: preview previa →
 *   ganador commitea → perdedor 409 sin filas → reintento con preview
 *   posterior exitoso → exactamente UNA reserva final.
 * Datos estrictamente ficticios (R1/R12); Dado/Cuando/Entonces (R11).
 */
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import type { AuthConfig } from '../src/auth/types.js';
import type { AppConfig } from '../src/shared/config.js';

const AUTH: AuthConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-0002',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 5,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

const APP_CONFIG: AppConfig = {
  ...AUTH,
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  reservaOnline: {
    anticipacionMinSegundos: 7200,
    rateMax: 1000,
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60,
  },
  recordatorio: {
    t48hHoras: 48,
    t24hHoras: 24,
    canalPredeterminado: 'whatsapp',
  },
  caja: { zonaHoraria: 'America/Buenos_Aires' },
  mercadopago: {
    habilitado: false,
    ambiente: 'sandbox',
    token: null,
    webhookSecret: null,
  },
  chatbot: {
    simuladoHabilitado: true,
    sessionTtlSeconds: 1800,
    maxIntentosInvalidos: 5,
    rateMax: 1000,
    rateWindowSeconds: 60,
  },
};

const AHORA = new Date().toISOString();
const PAGO_CREADO_FIJO = '2026-11-05T12:00:00.000Z';
const ANULADO_UNO = '2026-11-20T10:00:00.000Z';

interface ClienteHttp {
  db: DatabaseSync;
  app: ReturnType<typeof createApp>;
  cerrar: () => void;
}

function abrir(): ClienteHttp {
  const db = openDatabase(':memory:');
  return {
    db,
    app: createApp(db, APP_CONFIG),
    cerrar: () => db.close(),
  };
}

/** Tokens firmados directo (patrón smoke de server.test.ts; roles = claims). */
function bearer(sub: string, roles: string[], email: string): string {
  return (
    'Bearer ' +
    signToken(
      { sub, tenantId: 'test', roles: roles as never, email, type: 'access', ttlSeconds: 900 },
      AUTH.jwtSecret,
    )
  );
}

const ADMIN = () => bearer('usr-1', ['administracion'], 'admin@example.test');
const RECEPCION = () => bearer('usr-1', ['recepcion'], 'rec@example.test');
const PROFES = () => bearer('usr-pro', ['profesional'], 'pro@example.test');

function sembrarBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sil-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Odontologo Ficticio Uno', 'MN-1111', 'Odontologia', 1, ?, ?),
            ('prof-2', 'Odontologo Ficticio Dos', 'MN-2222', 'Odontologia', 1, ?, ?),
            ('prof-3', 'Odontologo Ficticio Tres', 'MN-3333', 'Odontologia', 1, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at)
     VALUES ('usr-1', 'admin@example.test', 'hash', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
     VALUES ('usr-pro', 'pro@example.test', 'hash', 1, 'prof-1', ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
     VALUES ('osp-1', 'OS Ficticia', '210', 80, 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
     VALUES ('pac-1', 'Paciente Ficticio', '+54 9 11 0000-0000', 'osp-1', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-1', 'CONS-01', 'Consulta Ficticia', 30, ?, ?),
            ('pres-2', 'RES-02', 'Restauracion Ficticia', 60, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES
       ('tur-1', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
       ('tur-2', 'prof-1', 'sil-1', 'pac-1', 'pres-2', '2026-11-03T10:00:00.000Z', '2026-11-03T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
       ('tur-3', 'prof-2', 'sil-1', 'pac-1', 'pres-1', '2026-11-12T10:00:00.000Z', '2026-11-12T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
       ('tur-4', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-18T10:00:00.000Z', '2026-11-18T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA, AHORA, AHORA, AHORA, AHORA);
}

function pago(
  db: DatabaseSync,
  fila: { id: string; turnoId: string; monto: number; createdAt?: string },
): void {
  db.prepare(
    `INSERT INTO pago (id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado,
       clave_idempotencia, referencia, actor_usuario_id, anulado_por_usuario_id,
       motivo_anulacion, anulado_en, created_at, updated_at, deleted_at)
     VALUES (?, ?, NULL, ?, 'ARS', 'efectivo', 'cobrado', NULL, NULL, NULL,
             NULL, NULL, NULL, ?, ?, NULL)`,
  ).run(fila.id, fila.turnoId, fila.monto, fila.createdAt ?? PAGO_CREADO_FIJO, AHORA);
}

function movimiento(
  db: DatabaseSync,
  args: { id: string; pagoId: string; fecha: string },
): void {
  db.prepare(
    `INSERT INTO movimiento_caja (id, pago_id, tipo, monto_centavos, moneda,
       actor_usuario_id, fecha_contable, aplicado_en, motivo_asignacion, created_at)
     VALUES (?, ?, 'cobro', 1000, 'ARS', 'usr-1', ?, ?, NULL, ?)`,
  ).run(args.id, args.pagoId, args.fecha, args.fecha, AHORA);
}

function anular(db: DatabaseSync, pagoId: string, anuladoEn: string): void {
  db.prepare(
    `UPDATE pago SET estado = 'anulado', anulado_en = ?, updated_at = ? WHERE id = ?`,
  ).run(anuladoEn, AHORA, pagoId);
}

function contar(db: DatabaseSync, tabla: string, where = ''): number {
  const fila = db
    .prepare(`SELECT COUNT(*) AS n FROM ${tabla} ${where}`)
    .get() as { n: number };
  return fila.n;
}

async function configurarViaHttp(
  bl: ClienteHttp,
  profesionalId: string,
  pctGeneral: number = 40,
  tratamientos: ReadonlyArray<{ prestacion_id: string; pct: number }> = [
    { prestacion_id: 'pres-1', pct: 30 },
  ],
) {
  return await request(bl.app)
    .put(`/api/comisiones/configuraciones/${profesionalId}`)
    .set('authorization', ADMIN())
    .send({ pct_general: pctGeneral, tratamientos: [...tratamientos] });
}

describe('comisiones E2E — flujo completo por HTTP (C-13, tasks 7.1/6.1)', () => {
  let bl: ClienteHttp;

  beforeEach(() => {
    bl = abrir();
    sembrarBase(bl.db);
  });

  afterEach(() => {
    bl.cerrar();
  });

  it('Dado config + 2 cobros elegibles Cuando configuro→preview→genero→anular→confirmar(409)→regenero→confirmo→listo Entonces ciclo completo por HTTP con eventos y actor exactos', async () => {
    pago(bl.db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 }); // pres-1: 30% → 3000
    pago(bl.db, { id: 'pag-b', turnoId: 'tur-2', monto: 20000 }); // general 40% → 8000
    movimiento(bl.db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    movimiento(bl.db, { id: 'mov-b', pagoId: 'pag-b', fecha: '2026-11-06' });

    // 1) Configuración (admin): PUT + GET reflejan el estado.
    const putConfig = await configurarViaHttp(bl, 'prof-1');
    expect(putConfig.status).toBe(200);
    const getConfig = await request(bl.app)
      .get('/api/comisiones/configuraciones/prof-1')
      .set('authorization', ADMIN());
    expect(getConfig.status).toBe(200);
    expect(getConfig.body).toEqual({
      config: expect.objectContaining({ pct_general: 40 }),
      tratamientos: [expect.objectContaining({ prestacion_id: 'pres-1', pct: 30 })],
    });

    // 2) Preview: fingerprint + snapshot sin persistir NADA.
    const preview = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(preview.status).toBe(200);
    const fp = preview.body.fingerprint as string;
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual([
      'pag-a',
      'pag-b',
    ]);
    expect(preview.body.totales).toEqual({
      monto_items_centavos: 11000,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 11000,
    });
    expect(contar(bl.db, 'liquidacion_comision')).toBe(0);
    expect(contar(bl.db, 'liquidacion_comision_evento')).toBe(0);

    // 3) Generación (201, espejo C-12).
    const generar = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: fp,
      });
    expect(generar.status).toBe(201);
    expect(generar.body.liquidacion.estado).toBe('borrador');
    expect(generar.body.liquidacion.monto_items_centavos).toBe(11000);
    const id = generar.body.liquidacion.id as string;

    // 4) Cobro anulado tras generar: confirmar con fp de generación → 409.
    anular(bl.db, 'pag-a', ANULADO_UNO);
    const confirmarStale = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: fp });
    expect(confirmarStale.status).toBe(409);
    expect(confirmarStale.body).toEqual({ error: 'preview_desactualizado' });

    // 5) Re-preview (el borrador mismo período = vista de regeneración):
    //    pag-b sigue elegible (el propio borrador se excluye del guard D7) y
    //    pag-a anulado ya no está (sin confirmada previa → cero ajustes).
    //    Regenerar con fp fresco → snapshot solo pag-b → confirmar → historial
    //    sin duplicar `generada` (regenerar no inserta evento).
    const preview2 = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(preview2.status).toBe(200);
    expect(preview2.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual([
      'pag-b',
    ]);
    expect(preview2.body.totales).toEqual({
      monto_items_centavos: 8000,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 8000,
    });
    expect(preview2.body.ajustes).toHaveLength(0);
    const regenerar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/regenerar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: preview2.body.fingerprint });
    expect(regenerar.status).toBe(200);
    expect(regenerar.body.items).toHaveLength(1);
    expect(regenerar.body.items[0].pago_id).toBe('pag-b');
    expect(regenerar.body.items[0].monto_comision_centavos).toBe(8000);
    expect(regenerar.body.ajustes).toHaveLength(0);
    expect(regenerar.body.liquidacion.monto_total_centavos).toBe(8000);

    const confirmar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: preview2.body.fingerprint });
    expect(confirmar.status).toBe(200);
    expect(confirmar.body.liquidacion.estado).toBe('confirmada');

    // 6) Listar + detalle con eventos y actor exactos (admin).
    const listar = await request(bl.app)
      .get('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN());
    expect(listar.status).toBe(200);
    expect(listar.body).toHaveLength(1);
    const detalle = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${id}`)
      .set('authorization', ADMIN());
    expect(detalle.status).toBe(200);
    expect(detalle.body.liquidacion.monto_items_centavos).toBe(8000);
    expect(detalle.body.liquidacion.monto_total_centavos).toBe(8000);
    expect(
      detalle.body.eventos.map((e: { evento: string }) => e.evento),
    ).toEqual(['generada', 'confirmada']);
    expect(detalle.body.eventos[0].actor_usuario_id).toBe('usr-1');
    expect(detalle.body.eventos[1].actor_usuario_id).toBe('usr-1');
  });

  it('Dado preview y luego cambio de % cuando genero con el fingerprint ANTERIOR Entonces 409 preview_desactualizado sin persistir nada', async () => {
    pago(bl.db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    movimiento(bl.db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    await configurarViaHttp(bl, 'prof-1', 40, []);
    const preview1 = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });

    await request(bl.app)
      .put('/api/comisiones/configuraciones/prof-1')
      .set('authorization', ADMIN())
      .send({ pct_general: 55, tratamientos: [] });

    const generar = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: preview1.body.fingerprint,
      });
    expect(generar.status).toBe(409);
    expect(generar.body).toEqual({ error: 'preview_desactualizado' });
    expect(contar(bl.db, 'liquidacion_comision')).toBe(0);
    expect(contar(bl.db, 'liquidacion_comision_evento')).toBe(0);
  });

  it('Dado % cambiado tras generar cuando confirmo con fp de generación Entonces 409; re-preview→regenerar→confirmar recuperables; y la confirmada queda inmutable (regenerar y doble confirmar → estado_invalido)', async () => {
    pago(bl.db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    movimiento(bl.db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    await configurarViaHttp(bl, 'prof-1', 40, []);
    const pv = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    const generar = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: pv.body.fingerprint,
      });
    expect(generar.status).toBe(201);
    const id = generar.body.liquidacion.id as string;

    await request(bl.app)
      .put('/api/comisiones/configuraciones/prof-1')
      .set('authorization', ADMIN())
      .send({ pct_general: 55, tratamientos: [] });
    const confirmarStale = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv.body.fingerprint });
    expect(confirmarStale.status).toBe(409);
    expect(confirmarStale.body).toEqual({ error: 'preview_desactualizado' });

    const pv2 = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(pv2.body.items[0].monto_comision_centavos).toBe(5500); // 55%
    const regenerar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/regenerar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv2.body.fingerprint });
    expect(regenerar.status).toBe(200);
    expect(regenerar.body.items[0].monto_comision_centavos).toBe(5500);
    const confirmar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv2.body.fingerprint });
    expect(confirmar.status).toBe(200);

    // % cambia DESPUÉS de la confirmación: la captura queda inmutable (Q4/D4).
    await request(bl.app)
      .put('/api/comisiones/configuraciones/prof-1')
      .set('authorization', ADMIN())
      .send({ pct_general: 10, tratamientos: [] });
    const detalle = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${id}`)
      .set('authorization', ADMIN());
    expect(detalle.status).toBe(200);
    expect(detalle.body.liquidacion.monto_items_centavos).toBe(5500);
    const regenerarConfirmada = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/regenerar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv2.body.fingerprint });
    expect(regenerarConfirmada.status).toBe(409);
    expect(regenerarConfirmada.body).toEqual({ error: 'estado_invalido' });
    const dobleConfirmar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv2.body.fingerprint });
    expect(dobleConfirmar.status).toBe(409);
    expect(dobleConfirmar.body).toEqual({ error: 'estado_invalido' });
  });

  it('Dado roles de la matriz cuando acceden a rutas de gestión y portal Entonces recepción/profesional 403 en gestión; portal del profesional scoping forzado (Q6) y detalle ajeno/borrador → 404', async () => {
    pago(bl.db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    pago(bl.db, { id: 'pag-b', turnoId: 'tur-2', monto: 20000 });
    movimiento(bl.db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    movimiento(bl.db, { id: 'mov-b', pagoId: 'pag-b', fecha: '2026-11-06' });
    await configurarViaHttp(bl, 'prof-1', 40, []);
    const pv = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    const generar = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: pv.body.fingerprint,
      });
    expect(generar.status).toBe(201);
    const idPropiaConfirmada = generar.body.liquidacion.id as string;
    const confirmar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${idPropiaConfirmada}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv.body.fingerprint });
    expect(confirmar.status).toBe(200);

    // Confirmada AJENA (prof-2, pag-p2 10000@40 = 4000): invisible al portal.
    pago(bl.db, { id: 'pag-p2', turnoId: 'tur-3', monto: 10000 });
    movimiento(bl.db, { id: 'mov-p2', pagoId: 'pag-p2', fecha: '2026-11-15' });
    await configurarViaHttp(bl, 'prof-2', 40, []);
    const pvProf2 = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-2', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(pvProf2.status).toBe(200);
    const genProf2 = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-2',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: pvProf2.body.fingerprint,
      });
    expect(genProf2.status).toBe(201);
    const idAjena = genProf2.body.liquidacion.id as string;
    const confProf2 = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${idAjena}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pvProf2.body.fingerprint });
    expect(confProf2.status).toBe(200);

    // Borrador NUEVO propio (prof-1, 17..19 con pag-c 5000@40 = 2000): la
    // confirmada ajena NO interfiere y Q6 lo oculta al portal.
    pago(bl.db, { id: 'pag-c', turnoId: 'tur-4', monto: 5000 });
    movimiento(bl.db, { id: 'mov-c', pagoId: 'pag-c', fecha: '2026-11-18' });
    const pvBorrador = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-17', hasta: '2026-11-19' });
    expect(pvBorrador.status).toBe(200);
    expect(pvBorrador.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual(['pag-c']);
    expect(pvBorrador.body.totales.monto_total_centavos).toBe(2000);
    const genBorrador = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-17',
        hasta: '2026-11-19',
        fingerprint: pvBorrador.body.fingerprint,
      });
    expect(genBorrador.status).toBe(201);
    expect(genBorrador.body.liquidacion.estado).toBe('borrador');
    const idBorradorPropio = genBorrador.body.liquidacion.id as string;

    // Listado de administración: 3 vigentes (2 confirmadas + 1 borrador).
    const listar = await request(bl.app)
      .get('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN());
    expect(listar.status).toBe(200);
    expect(listar.body).toHaveLength(3);

    // Recepción: 403 en todo el ciclo de gestión y del portal (R4).
    const respuestasRecepcion = await Promise.all([
      request(bl.app)
        .put('/api/comisiones/configuraciones/prof-1')
        .set('authorization', RECEPCION())
        .send({ pct_general: 40, tratamientos: [] }),
      request(bl.app)
        .post('/api/comisiones/preview')
        .set('authorization', RECEPCION())
        .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' }),
      request(bl.app)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', RECEPCION())
        .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30', fingerprint: 'a'.repeat(64) }),
      request(bl.app)
        .get('/api/comisiones/liquidaciones')
        .set('authorization', RECEPCION()),
      request(bl.app)
        .get(`/api/comisiones/liquidaciones/${idPropiaConfirmada}`)
        .set('authorization', RECEPCION()),
      request(bl.app)
        .get('/api/comisiones/mis-liquidaciones')
        .set('authorization', RECEPCION()),
    ]);
    for (const respuesta of respuestasRecepcion) {
      expect(respuesta.status).toBe(403);
      expect(respuesta.body).toEqual({ error: 'forbidden' });
    }

    // Profesional: 403 en gestión (R4).
    const respuestasProfesional = await Promise.all([
      request(bl.app)
        .post('/api/comisiones/preview')
        .set('authorization', PROFES())
        .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' }),
      request(bl.app)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', PROFES())
        .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30', fingerprint: 'a'.repeat(64) }),
      request(bl.app)
        .put('/api/comisiones/configuraciones/prof-1')
        .set('authorization', PROFES())
        .send({ pct_general: 40, tratamientos: [] }),
    ]);
    for (const respuesta of respuestasProfesional) {
      expect(respuesta.status).toBe(403);
      expect(respuesta.body).toEqual({ error: 'forbidden' });
    }

    // Portal (Q6): SOLO la confirmada propia del profesional del token.
    const portal = await request(bl.app)
      .get('/api/comisiones/mis-liquidaciones')
      .set('authorization', PROFES());
    expect(portal.status).toBe(200);
    expect(portal.body).toHaveLength(1);
    expect(portal.body[0].id).toBe(idPropiaConfirmada);
    expect(portal.body[0].profesional_id).toBe('prof-1');
    expect(portal.body[0].estado).toBe('confirmada');
    expect(portal.body[0].monto_items_centavos).toBe(12000);

    // Scoping forzado: autoscopiar por query es IGNORADO (jamás por body/query).
    const portalMaquinado = await request(bl.app)
      .get('/api/comisiones/mis-liquidaciones?profesional_id=prof-2')
      .set('authorization', PROFES());
    expect(portalMaquinado.status).toBe(200);
    expect(
      portalMaquinado.body.map((l: { id: string }) => l.id),
    ).toEqual([idPropiaConfirmada]);

    // Detalle por id: la confirmada PROPIA es visible (branch de rol).
    const detallePropia = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${idPropiaConfirmada}`)
      .set('authorization', PROFES());
    expect(detallePropia.status).toBe(200);
    expect(detallePropia.body.liquidacion.id).toBe(idPropiaConfirmada);
    expect(detallePropia.body.liquidacion.profesional_id).toBe('prof-1');
    expect(detallePropia.body.liquidacion.monto_items_centavos).toBe(12000);
    expect(
      detallePropia.body.eventos.map((e: { evento: string }) => e.evento),
    ).toEqual(['generada', 'confirmada']);

    // La confirmada AJENA y el borrador PROPIO NO se exponen: 404 apagado,
    // exactamente {error:'not_found'}, sin montos ni existencia (R3/Q6).
    const detalleAjena = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${idAjena}`)
      .set('authorization', PROFES());
    expect(detalleAjena.status).toBe(404);
    expect(detalleAjena.body).toEqual({ error: 'not_found' });
    const detalleBorrador = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${idBorradorPropio}`)
      .set('authorization', PROFES());
    expect(detalleBorrador.status).toBe(404);
    expect(detalleBorrador.body).toEqual({ error: 'not_found' });

    // Contraste: administración SÍ ve la misma confirmada ajena (200).
    const detalleAdmin = await request(bl.app)
      .get(`/api/comisiones/liquidaciones/${idAjena}`)
      .set('authorization', ADMIN());
    expect(detalleAdmin.status).toBe(200);
    expect(detalleAdmin.body.liquidacion.profesional_id).toBe('prof-2');
    expect(detalleAdmin.body.liquidacion.monto_items_centavos).toBe(4000);
  });
});

describe('comisiones E2E — mapeo de errores de dominio a HTTP (C-13, task 6.2)', () => {
  let bl!: ClienteHttp;

  beforeEach(() => {
    bl = abrir();
    sembrarBase(bl.db);
  });

  afterEach(() => {
    bl.cerrar();
  });

  it('Dado cada ComisionError cuando cruza las rutas Entonces sin_configuracion/validacion → 422, not_found → 404, periodo_ya_liquidado/estado_invalido → 409 y 401 sin token, con cuerpos solo {error[, detalle]} (R3)', async () => {
    // 422 sin_configuracion: prof-3 sin % general vigente (sin detalle: R3).
    const sinConfig = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-3', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(sinConfig.status).toBe(422);
    expect(sinConfig.body).toEqual({ error: 'sin_configuracion' });

    // 422 validacion: fecha no ISO y rango invertido (con detalle de validación).
    const fechaMala = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-3', desde: '2026-11-01', hasta: '30/11/2026' });
    expect(fechaMala.status).toBe(422);
    expect(fechaMala.body.error).toBe('validacion');
    expect(typeof fechaMala.body.detalle).toBe('string');
    const rangoInvertido = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-3', desde: '2026-12-01', hasta: '2026-11-01' });
    expect(rangoInvertido.status).toBe(422);
    expect(rangoInvertido.body.error).toBe('validacion');

    // 422 validacion por guard del ROUTE: fingerprint ausente al generar.
    const sinFp = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-3', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(sinFp.status).toBe(422);
    expect(sinFp.body.error).toBe('validacion');

    // Ciclo corto: preview → generar → confirmar (para 404 y 409 de estado).
    pago(bl.db, { id: 'pag-er', turnoId: 'tur-1', monto: 10000 });
    movimiento(bl.db, { id: 'mov-er', pagoId: 'pag-er', fecha: '2026-11-05' });
    await configurarViaHttp(bl, 'prof-1', 40, []);
    const pv = await request(bl.app)
      .post('/api/comisiones/preview')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(pv.status).toBe(200);
    const gen = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({
        profesional_id: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: pv.body.fingerprint,
      });
    expect(gen.status).toBe(201);
    const id = gen.body.liquidacion.id as string;

    // 404 not_found: id inexistente en el detalle (sin montos: R3).
    const inexistente = await request(bl.app)
      .get('/api/comisiones/liquidaciones/liq-fantasma')
      .set('authorization', ADMIN());
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toEqual({ error: 'not_found' });

    // 409 periodo_ya_liquidado: mismo período exacto ya registrado (borrador).
    const repetido = await request(bl.app)
      .post('/api/comisiones/liquidaciones')
      .set('authorization', ADMIN())
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30', fingerprint: 'a'.repeat(64) });
    expect(repetido.status).toBe(409);
    expect(repetido.body).toEqual({ error: 'periodo_ya_liquidado' });

    // 409 estado_invalido: regenerar y confirmar sobre una ya CONFIRMADA.
    const conf = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: pv.body.fingerprint });
    expect(conf.status).toBe(200);
    const regenerarConfirmada = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/regenerar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: 'a'.repeat(64) });
    expect(regenerarConfirmada.status).toBe(409);
    expect(regenerarConfirmada.body).toEqual({ error: 'estado_invalido' });
    const dobleConfirmar = await request(bl.app)
      .post(`/api/comisiones/liquidaciones/${id}/confirmar`)
      .set('authorization', ADMIN())
      .send({ fingerprint: 'a'.repeat(64) });
    expect(dobleConfirmar.status).toBe(409);
    expect(dobleConfirmar.body).toEqual({ error: 'estado_invalido' });

    // 401 no_autenticado: preview sin token.
    const sinToken = await request(bl.app)
      .post('/api/comisiones/preview')
      .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-30' });
    expect(sinToken.status).toBe(401);
    expect(sinToken.body).toEqual({ error: 'no_autenticado' });
  });
});

describe('comisiones E2E — carrera de reserva de ajustes con 2 conexiones reales (C-13, task 7.3)', () => {
  it('Dado DOS apps sobre DOS conexiones reales de la MISMA BD en fichero Cuando el ganador reserva el ajuste y el perdedor genera con fingerprint PRE-reserva Entonces el perdedor recibe 409 sin persistir nada, el reintento con nueva preview es exitoso y la BD termina con EXACTAMENTE UNA fila reservado para ese item_origen_id', async () => {
    // Dos CONEXIONES reales al mismo fichero (P2/D13): A aplica migraciones,
    // B abre la misma BD ya migrada — sin sleeps, llamadas secuenciadas.
    const dir = mkdtempSync(join(tmpdir(), 'c13-carrera-'));
    const fichero = join(dir, 'turnos.sqlite');
    const dbA = openDatabase(fichero);
    const dbB = new DatabaseSync(fichero);
    const appA = createApp(dbA, APP_CONFIG);
    const appB = createApp(dbB, APP_CONFIG);
    try {
      sembrarBase(dbA);
      const put = await request(appA)
        .put('/api/comisiones/configuraciones/prof-1')
        .set('authorization', ADMIN())
        .send({ pct_general: 40, tratamientos: [] });
      expect(put.status).toBe(200);

      // Liquidación 1: pag-x 25000@40 = 10000 (período 01-10), confirmada.
      pago(dbA, { id: 'pag-x', turnoId: 'tur-1', monto: 25000 });
      movimiento(dbA, { id: 'mov-x', pagoId: 'pag-x', fecha: '2026-11-02' });
      const pvL1 = await request(appB)
        .post('/api/comisiones/preview')
        .set('authorization', ADMIN())
        .send({ profesional_id: 'prof-1', desde: '2026-11-01', hasta: '2026-11-10' });
      expect(pvL1.status).toBe(200);
      expect(pvL1.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual(['pag-x']);
      const genL1 = await request(appA)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', ADMIN())
        .send({
          profesional_id: 'prof-1',
          desde: '2026-11-01',
          hasta: '2026-11-10',
          fingerprint: pvL1.body.fingerprint,
        });
      expect(genL1.status).toBe(201);
      expect(genL1.body.liquidacion.monto_total_centavos).toBe(10000);
      const idL1 = genL1.body.liquidacion.id as string;
      const confL1 = await request(appA)
        .post(`/api/comisiones/liquidaciones/${idL1}/confirmar`)
        .set('authorization', ADMIN())
        .send({ fingerprint: pvL1.body.fingerprint });
      expect(confL1.status).toBe(200);

      // Anulación POST-confirmación (pendiente D12) + cobro nuevo pg 25/11.
      anular(dbA, 'pag-x', ANULADO_UNO);
      pago(dbA, { id: 'pag-z', turnoId: 'tur-1', monto: 10000 });
      movimiento(dbA, { id: 'mov-z', pagoId: 'pag-z', fecha: '2026-11-25' });

      // Fingerprints PRE-reserva: el perdedor (21-30) ve pag-z + el pendiente;
      // el ganador (11-20) solo el pendiente (mismo item_origen_id).
      const pvPerdedor = await request(appB)
        .post('/api/comisiones/preview')
        .set('authorization', ADMIN())
        .send({ profesional_id: 'prof-1', desde: '2026-11-21', hasta: '2026-11-30' });
      expect(pvPerdedor.status).toBe(200);
      expect(pvPerdedor.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual(['pag-z']);
      expect(pvPerdedor.body.ajustes).toHaveLength(1);
      expect(pvPerdedor.body.ajustes[0].tipo_ajuste).toBe('anulacion_cobro');
      expect(pvPerdedor.body.ajustes[0].pago_id).toBe('pag-x');
      expect(pvPerdedor.body.ajustes[0].monto_ajuste_centavos).toBe(10000);
      const fpPerdedor = pvPerdedor.body.fingerprint as string;

      const pvGanador = await request(appA)
        .post('/api/comisiones/preview')
        .set('authorization', ADMIN())
        .send({ profesional_id: 'prof-1', desde: '2026-11-11', hasta: '2026-11-20' });
      expect(pvGanador.status).toBe(200);
      expect(pvGanador.body.items).toHaveLength(0);
      expect(pvGanador.body.ajustes).toHaveLength(1);
      const itemOrigenId = pvGanador.body.ajustes[0].item_origen_id as string;
      expect(pvGanador.body.ajustes[0].item_origen_id).toBeTruthy();

      // (1) Ganador (generación 1): 201 y RESERVA del ajuste (estado reservado).
      const genGanador = await request(appA)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', ADMIN())
        .send({
          profesional_id: 'prof-1',
          desde: '2026-11-11',
          hasta: '2026-11-20',
          fingerprint: pvGanador.body.fingerprint,
        });
      expect(genGanador.status).toBe(201);
      expect(genGanador.body.liquidacion.estado).toBe('borrador');
      expect(genGanador.body.liquidacion.monto_items_centavos).toBe(0);
      expect(genGanador.body.liquidacion.monto_ajustes_centavos).toBe(10000);
      expect(genGanador.body.liquidacion.monto_total_centavos).toBe(-10000);
      expect(genGanador.body.ajustes).toHaveLength(1);
      expect(genGanador.body.ajustes[0].estado_ajuste).toBe('reservado');
      expect(genGanador.body.ajustes[0].item_origen_id).toBe(itemOrigenId);
      const idGanador = genGanador.body.liquidacion.id as string;

      // (1) Perdedor (generación 2) con el fingerprint PRE-reserva → 409.
      const genPerdedor = await request(appB)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', ADMIN())
        .send({
          profesional_id: 'prof-1',
          desde: '2026-11-21',
          hasta: '2026-11-30',
          fingerprint: fpPerdedor,
        });
      expect(genPerdedor.status).toBe(409);
      expect(genPerdedor.body).toEqual({ error: 'preview_desactualizado' });

      // (2) El perdedor NO persistió NADA: conteo por la CONEXIÓN B (misma BD,
      // otra conexión real) — ni cabecera del período 21-30, ni ítems, y la
      // única reserva vigente sigue siendo la del ganador.
      expect(contar(dbB, 'liquidacion_comision', 'WHERE deleted_at IS NULL')).toBe(2);
      expect(
        contar(dbB, 'liquidacion_comision', "WHERE desde = '2026-11-21' AND hasta = '2026-11-30'"),
      ).toBe(0);
      expect(contar(dbB, 'liquidacion_comision_item', "WHERE pago_id = 'pag-z'")).toBe(0);
      expect(
        contar(dbB, 'liquidacion_comision_ajuste', "WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL"),
      ).toBe(1);

      // (3) Nueva preview + reintento del perdedor → exitoso SIN el ajuste
      // (reserve exclusiva del ganador; el total coincide con la nueva preview).
      const pvReintento = await request(appB)
        .post('/api/comisiones/preview')
        .set('authorization', ADMIN())
        .send({ profesional_id: 'prof-1', desde: '2026-11-21', hasta: '2026-11-30' });
      expect(pvReintento.status).toBe(200);
      expect(pvReintento.body.fingerprint).not.toBe(fpPerdedor);
      expect(pvReintento.body.ajustes).toHaveLength(0);
      expect(pvReintento.body.items.map((i: { pago_id: string }) => i.pago_id)).toEqual(['pag-z']);
      expect(pvReintento.body.totales).toEqual({
        monto_items_centavos: 4000,
        monto_ajustes_centavos: 0,
        monto_total_centavos: 4000,
      });
      const genReintento = await request(appB)
        .post('/api/comisiones/liquidaciones')
        .set('authorization', ADMIN())
        .send({
          profesional_id: 'prof-1',
          desde: '2026-11-21',
          hasta: '2026-11-30',
          fingerprint: pvReintento.body.fingerprint,
        });
      expect(genReintento.status).toBe(201);
      expect(genReintento.body.liquidacion.estado).toBe('borrador');
      expect(genReintento.body.ajustes).toHaveLength(0);
      expect(genReintento.body.items).toHaveLength(1);
      expect(genReintento.body.items[0].pago_id).toBe('pag-z');
      expect(genReintento.body.items[0].monto_comision_centavos).toBe(4000);
      expect(genReintento.body.liquidacion.monto_total_centavos).toBe(
        pvReintento.body.totales.monto_total_centavos,
      );

      // (4) La BD termina con EXACTAMENTE UNA fila reservado para ese
      // item_origen_id (host: el ganador) — sin reservas duplicadas en todo
      // el log de ajustes (UNIQUE parcial com_ajuste_reserva_activa).
      const reservaFinal = dbA
        .prepare(
          `SELECT liquidacion_id FROM liquidacion_comision_ajuste
            WHERE item_origen_id = ? AND estado_ajuste = 'reservado' AND deleted_at IS NULL`,
        )
        .all(itemOrigenId) as unknown as Array<{ liquidacion_id: string }>;
      expect(reservaFinal).toHaveLength(1);
      expect(reservaFinal[0].liquidacion_id).toBe(idGanador);
      expect(contar(dbB, 'liquidacion_comision_ajuste')).toBe(1);
    } finally {
      dbA.close();
      dbB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
