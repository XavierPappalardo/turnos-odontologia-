/**
 * Tasks 5.2/5.3: servicios de generación/regeneración/confirmación de
 * liquidaciones de comisiones (C-13, design D8/D9/D12/D13).
 * - SQLite REAL en memoria por escenario (R12: sin mocks de transacción;
 *   UnitOfWork `BEGIN IMMEDIATE` real) y, para concurrencia, DOS conexiones
 *   reales sobre una BD temporal COMPARTIDA EN FICHERO (task 5.3) — sin
 *   sleeps ni timings arbitrarios: el orden causal de la carrera se fija
 *   de forma determinista (preview previa → ganador commitea → perdedor
 *   intenta con fingerprint previo), que es exactamente el estado que la
 *   re-derivación intra-tx de D13 detecta.
 * - Escenarios Dado/Cuando/Entonces (R11); datos estrictamente ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { ComisionError } from '../src/shared/errors.js';
import { ComisionesConfigService } from '../src/comisiones/configuraciones.service.js';
import {
  ComisionesLiquidacionesService,
  type BorradorPersistida,
  type ResumenPreviewComision,
} from '../src/comisiones/liquidaciones.service.js';
import { LiquidacionComisionRepository } from '../src/comisiones/liquidacion.repository.js';
import { LiquidacionItemRepository } from '../src/comisiones/liquidacionItem.repository.js';
import { LiquidacionAjusteRepository } from '../src/comisiones/liquidacionAjuste.repository.js';

const AHORA = new Date().toISOString();
/** Fecha de negocio fija para todo pago (determinismo R12). */
const PAGO_CREADO_FIJO = '2026-11-05T12:00:00.000Z';
/** Instantes de anulación con orden determinista (absorción in-order, D12). */
const ANULADO_UNO = '2026-11-20T10:00:00.000Z';
const ANULADO_DOS = '2026-11-20T22:00:00.000Z';
const PLAYERO = 'usr-1';
const HEX64_RE = /^[0-9a-f]{64}$/;

function sembrarBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sil-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Odontologo Ficticio Uno', 'MN-1111', 'Odontologia', 1, ?, ?),
            ('prof-2', 'Odontologo Ficticio Dos', 'MN-2222', 'Odontologia', 1, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at)
     VALUES ('usr-1', 'admin@example.test', 'hash', 1, ?, ?)`,
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
       ('tur-2', 'prof-1', 'sil-1', 'pac-1', 'pres-2', '2026-11-03T10:00:00.000Z', '2026-11-03T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
}

function insertarPago(
  db: DatabaseSync,
  fila: {
    id: string;
    turnoId: string | null;
    monto?: number;
    medio?: string;
    estado?: string;
    anuladoEn?: string | null;
    createdAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO pago (
      id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado,
      clave_idempotencia, referencia, actor_usuario_id,
      anulado_por_usuario_id, motivo_anulacion, anulado_en,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, NULL, ?, 'ARS', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)`,
  ).run(
    fila.id,
    fila.turnoId,
    fila.monto ?? 10000,
    fila.medio ?? 'efectivo',
    fila.estado ?? 'cobrado',
    fila.anuladoEn ?? null,
    fila.createdAt ?? PAGO_CREADO_FIJO,
    AHORA,
  );
}

function insertarMovimiento(
  db: DatabaseSync,
  args: { id: string; pagoId: string; fecha: string; tipo?: 'cobro' | 'anulacion' },
): void {
  db.prepare(
    `INSERT INTO movimiento_caja (
      id, pago_id, tipo, monto_centavos, moneda, actor_usuario_id,
      fecha_contable, aplicado_en, motivo_asignacion, created_at
    ) VALUES (?, ?, ?, 1000, 'ARS', 'usr-1', ?, ?, NULL, ?)`,
  ).run(args.id, args.pagoId, args.tipo ?? 'cobro', args.fecha, args.fecha, AHORA);
}

function anularPago(db: DatabaseSync, id: string, anuladoEn: string): void {
  db.prepare(
    `UPDATE pago SET estado = 'anulado', anulado_en = ?, updated_at = ? WHERE id = ?`,
  ).run(anuladoEn, AHORA, id);
}

function contarVigentes(db: DatabaseSync, tabla: string): number {
  const fila = db
    .prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE deleted_at IS NULL`)
    .get() as { n: number };
  return fila.n;
}

function contarTotal(db: DatabaseSync, tabla: string): number {
  const fila = db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number };
  return fila.n;
}

function capturarComision(fn: () => unknown): ComisionError {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof ComisionError) return err;
    throw err;
  }
  throw new Error('la operación debía lanzar un ComisionError');
}

function capturarCualquiera(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err: unknown) {
    return err;
  }
  throw new Error('la operación debía lanzar');
}

function configurar(
  db: DatabaseSync,
  pctGeneral: number,
  tratamientos: { prestacion_id: string; pct: number }[] = [],
): void {
  new ComisionesConfigService(db).guardarConfiguracion({
    profesional_id: 'prof-1',
    pct_general: pctGeneral,
    tratamientos,
  });
}

/** Preview del profesional ficticio (scoping del test). */
function preview(
  servicio: ComisionesLiquidacionesService,
  desde = '2026-11-01',
  hasta = '2026-11-30',
): ResumenPreviewComision {
  return servicio.calcularPreview('prof-1', desde, hasta);
}

/** Genera con fingerprint fresco (o el indicado, para carreras). */
function generar(
  servicio: ComisionesLiquidacionesService,
  desde = '2026-11-01',
  hasta = '2026-11-30',
  fingerprint?: string,
): BorradorPersistida {
  const fp = fingerprint ?? preview(servicio, desde, hasta).fingerprint;
  return servicio.generarBorrador({
    profesionalId: 'prof-1',
    desde,
    hasta,
    fingerprint: fp,
    actorUsuarioId: PLAYERO,
  });
}

describe('comisiones/liquidaciones.service — generación (C-13, task 5.2)', () => {
  let db: DatabaseSync;
  let servicio: ComisionesLiquidacionesService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarBase(db);
    servicio = new ComisionesLiquidacionesService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado 3 cobros elegibles (10.000 c/30% específico, 20.000 c/40% general y 9.999 c/30% truncado) Cuando genero con el fingerprint vigente Entonces cabecera borrador con ítems-snapshot exactos, Σ exacta y evento generada', () => {
    configurar(db, 40, [{ prestacion_id: 'pres-1', pct: 30 }]);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    insertarPago(db, { id: 'pag-b', turnoId: 'tur-2', monto: 20000 });
    insertarMovimiento(db, { id: 'mov-b', pagoId: 'pag-b', fecha: '2026-11-06' });
    insertarPago(db, { id: 'pag-c', turnoId: 'tur-1', monto: 9999 });
    insertarMovimiento(db, { id: 'mov-c', pagoId: 'pag-c', fecha: '2026-11-07' });

    const pv = preview(servicio);
    expect(pv.fingerprint).toMatch(HEX64_RE);
    expect(pv.items.map((i) => i.pago_id)).toEqual(['pag-a', 'pag-b', 'pag-c']);
    expect(pv.items[0]).toMatchObject({
      pct_aplicado: 30,
      regla_aplicada: 'tratamiento',
      fecha_contable: '2026-11-05',
      monto_cobro_centavos: 10000,
      monto_comision_centavos: 3000,
    });
    expect(pv.items[1]).toMatchObject({
      pct_aplicado: 40,
      regla_aplicada: 'general',
      monto_comision_centavos: 8000,
    });
    // Q5 truncado: floor(9999 × 30 / 100) = 2999 (R2: enteros exactos).
    expect(pv.items[2]!.monto_comision_centavos).toBe(2999);
    expect(pv.totales).toEqual({
      monto_items_centavos: 13999,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 13999,
    });

    const borrador = generar(servicio);
    expect(borrador.liquidacion.estado).toBe('borrador');
    expect(borrador.liquidacion.monto_items_centavos).toBe(13999);
    expect(borrador.liquidacion.monto_ajustes_centavos).toBe(0);
    expect(borrador.liquidacion.monto_total_centavos).toBe(13999);
    expect(borrador.liquidacion.saldo_compensacion_centavos).toBe(0);
    expect(borrador.items).toHaveLength(3);
    expect(borrador.ajustes).toHaveLength(0);
    const eventos = db
      .prepare('SELECT evento, actor_usuario_id FROM liquidacion_comision_evento')
      .all() as { evento: string; actor_usuario_id: string }[];
    expect(eventos).toEqual([{ evento: 'generada', actor_usuario_id: PLAYERO }]);
    // La preview jamás persistió: solo la cabecera de la generación existe.
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(1);
  });

  it('Dado dos previews sin cambios Cuando re-previsualizo Entonces mismo fingerprint; Dado pct cambiado y generación con el fp ANTERIOR Entonces 409 preview_desactualizado sin ninguna fila', () => {
    configurar(db, 20);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });

    const pv1 = preview(servicio);
    const pv2 = preview(servicio);
    expect(pv2.fingerprint).toBe(pv1.fingerprint);

    configurar(db, 45);
    const pv3 = preview(servicio);
    expect(pv3.fingerprint).not.toBe(pv1.fingerprint);

    const error = capturarComision(() => generar(servicio, '2026-11-01', '2026-11-30', pv1.fingerprint));
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(0);
    expect(contarVigentes(db, 'liquidacion_comision_item')).toBe(0);
    expect(contarVigentes(db, 'liquidacion_comision_ajuste')).toBe(0);
    expect(contarTotal(db, 'liquidacion_comision_evento')).toBe(0);
  });

  it('Dado un cobro NUEVO insertado después del preview Cuando genero con el fingerprint previo Entonces 409 preview_desactualizado (los cambios del conjunto de cobros derriten la semilla D13)', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    const fpPrevio = preview(servicio).fingerprint;

    insertarPago(db, { id: 'pag-b', turnoId: 'tur-2', monto: 12000 });
    insertarMovimiento(db, { id: 'mov-b', pagoId: 'pag-b', fecha: '2026-11-06' });

    const error = capturarComision(() => generar(servicio, '2026-11-01', '2026-11-30', fpPrevio));
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(0);
  });

  it('Dado cobro anulado después de generar Cuando confirmo con el fingerprint del borrador Entonces 409; Dado re-preview, regeneración y confirmación Entonces confirmada SIN el ítem anulado, sin ajuste y SIN duplicar el evento generada', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    const borrador = generar(servicio);
    const fpGeneracion = borrador.liquidacion.fingerprint;

    anularPago(db, 'pag-a', ANULADO_UNO);
    const error = capturarComision(() =>
      servicio.confirmarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: fpGeneracion,
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');

    const pv = preview(servicio);
    expect(pv.items).toHaveLength(0);
    expect(pv.ajustes).toHaveLength(0); // el ítem nunca llegó a confirmada: no hay ajuste (spec)
    const regenerado = servicio.regenerarBorrador({
      liquidacionId: borrador.liquidacion.id,
      fingerprint: pv.fingerprint,
    });
    expect(regenerado.items).toHaveLength(0);
    expect(regenerado.liquidacion.monto_items_centavos).toBe(0);
    expect(regenerado.liquidacion.fingerprint).toBe(pv.fingerprint);
    // Sin duplicar el evento `generada`: el historial previo se conserva.
    expect(contarTotal(db, 'liquidacion_comision_evento')).toBe(1);
    // El ítem originado quedó de baja lógica por la regeneración.
    expect(contarVigentes(db, 'liquidacion_comision_item')).toBe(0);
    expect(contarTotal(db, 'liquidacion_comision_item')).toBe(1);

    const confirmada = servicio.confirmarBorrador({
      liquidacionId: borrador.liquidacion.id,
      fingerprint: pv.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    expect(confirmada.liquidacion.estado).toBe('confirmada');
    expect(confirmada.liquidacion.monto_total_centavos).toBe(0);
    expect(confirmada.liquidacion.saldo_compensacion_centavos).toBe(0);
    const eventos = db
      .prepare('SELECT evento FROM liquidacion_comision_evento ORDER BY created_at ASC')
      .all() as { evento: string }[];
    expect(eventos.map((e) => e.evento)).toEqual(['generada', 'confirmada']);
  });

  it('Dado pct cambiado tras generar Cuando confirmo con el fingerprint de generación Entonces 409 preview_desactualizado y nada se congela (estado sigue borrador, montos intactos)', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    const borrador = generar(servicio);
    const fpGeneracion = borrador.liquidacion.fingerprint;

    configurar(db, 55);
    const error = capturarComision(() =>
      servicio.confirmarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: fpGeneracion,
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    const cabecera = new LiquidacionComisionRepository(db).buscarPorIdVigente(
      borrador.liquidacion.id,
    )!;
    expect(cabecera.estado).toBe('borrador');
    expect(cabecera.monto_items_centavos).toBe(4000);
  });

  it('Dado liquidación vigente (p, desde, hasta) Cuando genero la MISMA combinación Entonces 409 periodo_ya_liquidado y persiste UNA cabecera', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    generar(servicio, '2026-11-01', '2026-11-10');
    const error = capturarComision(() => generar(servicio, '2026-11-01', '2026-11-10'));
    expect(error.status).toBe(409);
    expect(error.code).toBe('periodo_ya_liquidado');
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(1);
  });

  it('Dado períodos solapados (Q7 ratificada) Cuando genero ambos Entonces ambos se crean; un cobro dentro del rango de ambos queda SOLO en la primera y el preview lo reporta como descarte consultable (guard D7)', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-m', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-m', pagoId: 'pag-m', fecha: '2026-11-08' });
    insertarPago(db, { id: 'pag-n', turnoId: 'tur-2', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-n', pagoId: 'pag-n', fecha: '2026-11-15' });

    generar(servicio, '2026-11-01', '2026-11-10');
    const pvSolapado = preview(servicio, '2026-11-05', '2026-11-20');
    expect(pvSolapado.descartes).toContainEqual({
      pago_id: 'pag-m',
      motivo: 'cobro_ya_liquidado',
    });
    expect(pvSolapado.pagos_ya_liquidados).toEqual(['pag-m']);
    expect(pvSolapado.items.map((i) => i.pago_id)).toEqual(['pag-n']);
    const liq2 = generar(servicio, '2026-11-05', '2026-11-20');
    expect(liq2.items).toHaveLength(1);
    const duplicados = db
      .prepare(
        `SELECT COUNT(*) AS n FROM liquidacion_comision_item WHERE pago_id = 'pag-m' AND deleted_at IS NULL`,
      )
      .get() as { n: number };
    expect(duplicados.n).toBe(1); // guard anti doble-comisión D7
  });

  it('Dado rangos con formato inválido (no ISO-día, timestamp con hora, desde>hasta) Cuando pre-visualizo o genero Entonces 422 validacion sin persistir (R6/Q3)', () => {
    configurar(db, 40);
    const invalidos: [string, string][] = [
      ['2026-11-1', '2026-11-30'],
      ['2026-11-01T00:00:00.000Z', '2026-11-30'],
      ['2026-11-30', '2026-11-01'],
      ['2026-13-01', '2026-12-31'],
    ];
    for (const [desde, hasta] of invalidos) {
      const errPreview = capturarComision(() =>
        servicio.calcularPreview('prof-1', desde, hasta),
      );
      expect(errPreview.status).toBe(422);
      expect(errPreview.code).toBe('validacion');
      const errGenerar = capturarComision(() => generar(servicio, desde, hasta));
      expect(errGenerar.code).toBe('validacion');
    }
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(0);
  });

  it('Dado profesional inexistente Cuando pre-visualizo o genero Entonces 404 not_found', () => {
    const errPreview = capturarComision(() =>
      servicio.calcularPreview('prof-inexistente', '2026-11-01', '2026-11-30'),
    );
    expect(errPreview.status).toBe(404);
    expect(errPreview.code).toBe('not_found');
    const errGenerar = capturarComision(() =>
      servicio.generarBorrador({
        profesionalId: 'prof-inexistente',
        desde: '2026-11-01',
        hasta: '2026-11-30',
        fingerprint: 'a'.repeat(64),
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(errGenerar.code).toBe('not_found');
  });
});

describe('comisiones/liquidaciones.service — ajustes D12 (reservas, liberación, absorción, arrastre)', () => {
  let db: DatabaseSync;
  let servicio: ComisionesLiquidacionesService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarBase(db);
    servicio = new ComisionesLiquidacionesService(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Confirma y anula el cobro de la primera liquidación (base D12 común). */
  function prepararOrigenAnulado(args: { monto: number }): {
    liq1Id: string;
    itemOrigenId: string;
  } {
    insertarPago(db, { id: 'pag-x', turnoId: 'tur-1', monto: args.monto });
    insertarMovimiento(db, { id: 'mov-x', pagoId: 'pag-x', fecha: '2026-11-02' });
    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    expect(liq1.liquidacion.monto_items_centavos).toBeGreaterThan(0);
    servicio.confirmarBorrador({
      liquidacionId: liq1.liquidacion.id,
      fingerprint: liq1.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    anularPago(db, 'pag-x', ANULADO_UNO);
    return {
      liq1Id: liq1.liquidacion.id,
      itemOrigenId: liq1.items[0]!.id,
    };
  }

  it('Dado comisión confirmada cuyo pago se anula Cuando pre-visualizo y genero el siguiente borrador Entonces UNA fila reservado por item_origen con la comisión original no recalculada y total neto restado', () => {
    configurar(db, 40); // pag-x 10.000 → comisión 4.000
    const { liq1Id, itemOrigenId } = prepararOrigenAnulado({ monto: 10000 });

    const pv = preview(servicio, '2026-11-11', '2026-11-20');
    expect(pv.ajustes).toEqual([
      {
        item_origen_id: itemOrigenId,
        pago_id: 'pag-x',
        tipo_ajuste: 'anulacion_cobro',
        monto_ajuste_centavos: 4000,
      },
    ]);
    expect(pv.totales).toEqual({
      monto_items_centavos: 0,
      monto_ajustes_centavos: 4000,
      monto_total_centavos: -4000,
    });
    const liq2 = generar(servicio, '2026-11-11', '2026-11-20');
    expect(liq2.liquidacion.monto_ajustes_centavos).toBe(4000);
    expect(liq2.liquidacion.monto_total_centavos).toBe(-4000);
    expect(liq2.ajustes).toHaveLength(1);
    const reservada = liq2.ajustes[0]!;
    expect(reservada.estado_ajuste).toBe('reservado');
    expect(reservada.monto_ajuste_centavos).toBe(4000);
    expect(reservada.monto_compensado_centavos).toBe(0);
    expect(reservada.item_origen_id).toBe(itemOrigenId);
    expect(reservada.pago_id).toBe('pag-x');
    expect(reservada.tipo_ajuste).toBe('anulacion_cobro');
    // Reserva exclusiva: exactamente un `reservado` vigente para el origen
    // (índice único parcial `com_ajuste_reserva_activa`, D12).
    const reservaActivas = db
      .prepare(
        `SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste
          WHERE item_origen_id = ? AND estado_ajuste = 'reservado' AND deleted_at IS NULL`,
      )
      .get(itemOrigenId) as { n: number };
    expect(reservaActivas.n).toBe(1);
    // La liquidación confirmada original permanece inmutable (Q4).
    const liq1 = new LiquidacionComisionRepository(db).buscarPorIdVigente(liq1Id)!;
    expect(liq1.monto_items_centavos).toBe(4000);
    expect(liq1.monto_total_centavos).toBe(4000);
  });

  it('Dado la carrera por el mismo ajuste (perdedor con fingerprint PREVIO a la reserva) Cuando el ganador genera y el perdedor genera después Entonces perdedor 409 SIN filas, nueva preview permite generar SIN el ajuste y existe una única reserva', () => {
    configurar(db, 40); // pag-x 25.000 → comisión 10.000
    prepararOrigenAnulado({ monto: 25000 });
    insertarPago(db, { id: 'pag-z', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-z', pagoId: 'pag-z', fecha: '2026-11-25' });

    // Ambas previews ANTES de la reserva: ambos fingerprints todavía incluyen
    // el ajuste pendiente (estado determinista de la carrera, sin sleeps).
    const fpPerdedor = preview(servicio, '2026-11-21', '2026-11-30').fingerprint;
    const fpGanador = preview(servicio, '2026-11-11', '2026-11-20').fingerprint;

    // GANADOR: genera y commitea (reserva exclusiva del ajuste).
    const liq2 = generar(servicio, '2026-11-11', '2026-11-20', fpGanador);
    expect(liq2.ajustes).toHaveLength(1);

    // PERDEDOR: fingerprint previo a la reserva → derivación viva difiere.
    const error = capturarComision(() =>
      generar(servicio, '2026-11-21', '2026-11-30', fpPerdedor),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(2); // liq-1 + liq-2
    const reservaActivas = db
      .prepare(
        `SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste
          WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL`,
      )
      .get() as { n: number };
    expect(reservaActivas.n).toBe(1);

    // Reintento con preview POSTERIOR: el conjunto ya no incluye el ajuste.
    const pvFresca = preview(servicio, '2026-11-21', '2026-11-30');
    expect(pvFresca.ajustes).toHaveLength(0);
    expect(pvFresca.items.map((i) => i.pago_id)).toEqual(['pag-z']);
    const liq3 = generar(servicio, '2026-11-21', '2026-11-30', pvFresca.fingerprint);
    expect(liq3.items.map((i) => i.pago_id)).toEqual(['pag-z']);
    expect(liq3.ajustes).toHaveLength(0);
    const reservaTotal = db
      .prepare(
        `SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste
          WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL`,
      )
      .get() as { n: number };
    expect(reservaTotal.n).toBe(1);
  });

  it('Dado capacidad menor que el ajuste (ítems 4.000 y ajuste 10.000) Cuando confirmo Entonces absorción PARCIAL con compensado_en, saldo_compensacion 6.000, neto −6.000 y sin pagos negativos automáticos', () => {
    configurar(db, 40); // pag-x 25.000 → comisión 10.000.confirmar
    const { liq1Id } = prepararOrigenAnulado({ monto: 25000 });
    // Nuevo cobro del período siguiente con capacidad 4.000.
    insertarPago(db, { id: 'pag-x2', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-x2', pagoId: 'pag-x2', fecha: '2026-11-15' });

    const pv = preview(servicio, '2026-11-11', '2026-11-20');
    expect(pv.items.map((i) => i.pago_id)).toEqual(['pag-x2']);
    expect(pv.ajustes.map((a) => a.monto_ajuste_centavos)).toEqual([10000]);
    expect(pv.totales.monto_total_centavos).toBe(-6000);
    const liq2 = generar(servicio, '2026-11-11', '2026-11-20', pv.fingerprint);
    const confirmada = servicio.confirmarBorrador({
      liquidacionId: liq2.liquidacion.id,
      fingerprint: liq2.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    const ajuste = confirmada.ajustes[0]!;
    expect(ajuste.estado_ajuste).toBe('consumido');
    expect(ajuste.monto_ajuste_centavos).toBe(10000);
    expect(ajuste.monto_compensado_centavos).toBe(4000); // absorción parcial D12
    expect(ajuste.compensado_en).not.toBeNull();
    expect(confirmada.liquidacion.estado).toBe('confirmada');
    expect(confirmada.liquidacion.monto_items_centavos).toBe(4000);
    expect(confirmada.liquidacion.monto_ajustes_centavos).toBe(10000);
    expect(confirmada.liquidacion.monto_total_centavos).toBe(-6000);
    expect(confirmada.liquidacion.saldo_compensacion_centavos).toBe(6000);
    // Sin pagos negativos automáticos (P1): la tabla pago no cambia.
    expect(contarTotal(db, 'pago')).toBe(2);
    // La liquidación confirmada original sigue inmutable (Q4).
    const liq1 = new LiquidacionComisionRepository(db).buscarPorIdVigente(liq1Id)!;
    expect(liq1.monto_items_centavos).toBe(10000);
    expect(liq1.monto_total_centavos).toBe(10000);
  });

  it('Dado saldo de compensación pendiente (resto 10.000) Cuando confirmo un borrador sin ítems Entonces el resto pasa a arrastre; Dado preview en período posterior Entonces ajuste saldo_arrastre y su confirmación absorbe completo con saldo final 0', () => {
    configurar(db, 40);
    prepararOrigenAnulado({ monto: 25000 }); // arrastre pendiente 10.000 (sin cobros nuevos)
    // Período P3 SIN cobros: borrador con solo el ajuste reservado (contenido
    // líquible no vacío), confirmación con capacidad 0 → absorción nula →
    // TODO el ajuste queda como arrastre pasivo (P1).
    const pv = preview(servicio, '2026-11-21', '2026-11-30');
    expect(pv.items).toHaveLength(0);
    expect(pv.ajustes.map((a) => a.tipo_ajuste)).toEqual(['anulacion_cobro']);
    const liq2 = generar(servicio, '2026-11-21', '2026-11-30', pv.fingerprint);
    const confirmada2 = servicio.confirmarBorrador({
      liquidacionId: liq2.liquidacion.id,
      fingerprint: liq2.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    expect(confirmada2.ajustes[0]!.estado_ajuste).toBe('consumido');
    expect(confirmada2.ajustes[0]!.monto_compensado_centavos).toBe(0);
    expect(confirmada2.liquidacion.saldo_compensacion_centavos).toBe(10000);
    expect(confirmada2.liquidacion.monto_total_centavos).toBe(-10000);

    // Período posterior: detección (b) — el resto de la fila consumida
    // (10.000, absorción nula) pasa a saldo_arrastre con la misma reserva
    // exclusiva; capacidad nueva 10.000 (25.000 @ 40) lo absorbe completo.
    insertarPago(db, { id: 'pag-v', turnoId: 'tur-2', monto: 25000 });
    insertarMovimiento(db, { id: 'mov-v', pagoId: 'pag-v', fecha: '2026-12-05' });
    const pvArrastre = preview(servicio, '2026-12-01', '2026-12-10');
    expect(pvArrastre.ajustes).toHaveLength(1);
    const arrastre = pvArrastre.ajustes[0]!;
    expect(arrastre.tipo_ajuste).toBe('saldo_arrastre');
    expect(arrastre.monto_ajuste_centavos).toBe(10000);
    expect(arrastre.pago_id).toBe('pag-x');

    const liq3 = generar(servicio, '2026-12-01', '2026-12-10', pvArrastre.fingerprint);
    expect(liq3.ajustes[0]!.tipo_ajuste).toBe('saldo_arrastre');
    expect(liq3.ajustes[0]!.monto_ajuste_centavos).toBe(10000);
    const confirmada3 = servicio.confirmarBorrador({
      liquidacionId: liq3.liquidacion.id,
      fingerprint: liq3.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    expect(confirmada3.ajustes[0]!.monto_compensado_centavos).toBe(10000);
    expect(confirmada3.liquidacion.saldo_compensacion_centavos).toBe(0);
    expect(confirmada3.liquidacion.monto_total_centavos).toBe(0);
    // Sin restos: la próxima preview ya no lista arrastres (detection b vacía).
    const pvPosterior = preview(servicio, '2026-12-11', '2026-12-20');
    expect(pvPosterior.ajustes).toHaveLength(0);
  });

  it('Dado DOS anulaciones con anulado_en distinto y capacidad 8.000 Cuando confirmo Entonces absorción in-order determinista: el primero compensa completo (4.000) y el segundo parcial (4.000 de 10.000)', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-x', turnoId: 'tur-1', monto: 10000 }); // com 4.000
    insertarMovimiento(db, { id: 'mov-x', pagoId: 'pag-x', fecha: '2026-11-02' });
    insertarPago(db, { id: 'pag-y', turnoId: 'tur-2', monto: 25000 }); // com 10.000
    insertarMovimiento(db, { id: 'mov-y', pagoId: 'pag-y', fecha: '2026-11-03' });
    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    expect(liq1.liquidacion.monto_items_centavos).toBe(14000);
    servicio.confirmarBorrador({
      liquidacionId: liq1.liquidacion.id,
      fingerprint: liq1.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    anularPago(db, 'pag-x', ANULADO_UNO);
    anularPago(db, 'pag-y', ANULADO_DOS);
    insertarPago(db, { id: 'pag-c', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-c', pagoId: 'pag-c', fecha: '2026-11-12' });
    insertarPago(db, { id: 'pag-d', turnoId: 'tur-2', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-d', pagoId: 'pag-d', fecha: '2026-11-13' });

    const pv = preview(servicio, '2026-11-11', '2026-11-20');
    // Orden canon de absorción (D12): pago.anulado_en ASC, pago_id ASC.
    expect(pv.ajustes.map((a) => a.pago_id)).toEqual(['pag-x', 'pag-y']);
    expect(pv.ajustes.map((a) => a.monto_ajuste_centavos)).toEqual([4000, 10000]);
    const liq2 = generar(servicio, '2026-11-11', '2026-11-20', pv.fingerprint);
    const confirmada = servicio.confirmarBorrador({
      liquidacionId: liq2.liquidacion.id,
      fingerprint: liq2.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    const porPago = new Map(confirmada.ajustes.map((a) => [a.pago_id, a]));
    const primero = porPago.get('pag-x')!;
    const segundo = porPago.get('pag-y')!;
    expect(primero.estado_ajuste).toBe('consumido');
    expect(primero.monto_compensado_centavos).toBe(4000); // completo
    expect(segundo.estado_ajuste).toBe('consumido');
    expect(segundo.monto_compensado_centavos).toBe(4000); // parcial (10.000)
    expect(primero.compensado_en).not.toBeNull();
    expect(segundo.compensado_en).not.toBeNull();
    expect(confirmada.liquidacion.monto_ajustes_centavos).toBe(14000);
    expect(confirmada.liquidacion.saldo_compensacion_centavos).toBe(6000); // 14.000 − 8.000
  });

  it('Dado confirmación con fingerprint ajeno al borrador Cuando confirmo Entonces 409 preview_desactualizado (fingerprint ≠ almacenado) y el borrador queda intacto', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    const borrador = generar(servicio);
    const error = capturarComision(() =>
      servicio.confirmarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: 'a'.repeat(64),
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    const cabecera = new LiquidacionComisionRepository(db).buscarPorIdVigente(
      borrador.liquidacion.id,
    )!;
    expect(cabecera.estado).toBe('borrador');
    expect(cabecera.monto_items_centavos).toBe(4000);
  });

  it('Dado % cambiado después de generar Cuando regenero con el fingerprint ALMACENADO (ya desactualizado) Entonces 409 con ROLLBACK íntegro (ítem vigente, montos y fp intactos); Cuando regenero con fp fresco Entonces snapshot recalculado, ítem antiguo de baja y SIN evento nuevo', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
    const borrador = generar(servicio);
    const fpStale = borrador.liquidacion.fingerprint;

    configurar(db, 55); // 10.000 × 55% = 5.500
    const error = capturarComision(() =>
      servicio.regenerarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: fpStale,
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('preview_desactualizado');
    // ROLLBACK íntegro: la baja de ítems de la precedencia D13 revierte.
    expect(contarVigentes(db, 'liquidacion_comision_item')).toBe(1);
    expect(contarTotal(db, 'liquidacion_comision_item')).toBe(1);

    const pvFresca = preview(servicio);
    // Vista de REGENERACIÓN: la preview del período exacto del borrador propio
    // excluye sus capturas — muestra el ítem recalculado con el % nuevo y SIN
    // el descarte `cobro_ya_liquidado` por captura propia (D13).
    expect(pvFresca.items).toHaveLength(1);
    expect(pvFresca.items[0]).toMatchObject({
      pago_id: 'pag-a',
      monto_comision_centavos: 5500,
    });
    expect(pvFresca.descartes).toHaveLength(0);
    expect(pvFresca.pagos_ya_liquidados).toHaveLength(0);
    const regenerado = servicio.regenerarBorrador({
      liquidacionId: borrador.liquidacion.id,
      fingerprint: pvFresca.fingerprint,
    });
    expect(regenerado.items[0]!.monto_comision_centavos).toBe(5500);
    expect(regenerado.liquidacion.monto_items_centavos).toBe(5500);
    expect(regenerado.liquidacion.fingerprint).toBe(pvFresca.fingerprint);
    expect(contarTotal(db, 'liquidacion_comision_item')).toBe(2); // vieja de baja + nueva
    expect(contarVigentes(db, 'liquidacion_comision_item')).toBe(1);
    expect(contarTotal(db, 'liquidacion_comision_evento')).toBe(1); // sin duplicar generada
  });

  it('Dado id inexistente Cuando regenero o confirmo Entonces 404 not_found', () => {
    const errRegenerar = capturarComision(() =>
      servicio.regenerarBorrador({ liquidacionId: 'no-hay', fingerprint: 'a'.repeat(64) }),
    );
    expect(errRegenerar.status).toBe(404);
    expect(errRegenerar.code).toBe('not_found');
    const errConfirmar = capturarComision(() =>
      servicio.confirmarBorrador({
        liquidacionId: 'no-hay',
        fingerprint: 'a'.repeat(64),
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(errConfirmar.status).toBe(404);
    expect(errConfirmar.code).toBe('not_found');
  });
});

/** Reservas vigentes globales (control de carrera por ajuste). */
function dbContarReservas(db: DatabaseSync): number {
  const fila = db
    .prepare(
      `SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste
        WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL`,
    )
    .get() as { n: number };
  return fila.n;
}

// ─── Concurrencia REAL (task 5.3): 2 conexiones SQLite sobre BD compartida ──
describe('comisiones/liquidaciones.service — concurrencia real con 2 conexiones (BD compartida en fichero, sin mocks ni sleeps)', () => {
  interface Biblioteca {
    dir: string;
    dbA: DatabaseSync;
    dbB: DatabaseSync;
    servicioA: ComisionesLiquidacionesService;
    servicioB: ComisionesLiquidacionesService;
    cerrar: () => void;
  }

  function abrir(): Biblioteca {
    const dir = mkdtempSync(join(tmpdir(), 'c13-'));
    const fichero = join(dir, 'c13-conc.db');
    const dbA = openDatabase(fichero); // migraciones 001..012 aplicadas aquí
    const dbB = new DatabaseSync(fichero); // segunda conexión REAL, mismo esquema
    sembrarBase(dbA);
    return {
      dir,
      dbA,
      dbB,
      servicioA: new ComisionesLiquidacionesService(dbA),
      servicioB: new ComisionesLiquidacionesService(dbB),
      cerrar: () => {
        dbA.close();
        dbB.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it('Dado un borrador y doble-click concurrente con 2 conexiones reales Cuando ambos confirman Entonces 1 confirmada + 1 estado_invalido sin duplicar eventos ni mutar el snapshot', () => {
    const bl = abrir();
    try {
      configurar(bl.dbA, 40);
      insertarPago(bl.dbA, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
      insertarMovimiento(bl.dbA, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
      const borrador = generar(bl.servicioA);

      // Confirmación 1 (conexión real A): transiciona a confirmada.
      const confirmada = bl.servicioA.confirmarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: borrador.liquidacion.fingerprint,
        actorUsuarioId: PLAYERO,
      });
      expect(confirmada.liquidacion.estado).toBe('confirmada');

      // Confirmación 2 (conexión real B, mismo fingerprint del borrador): guard
      // de estado intra-tx con BEGIN IMMEDIATE real → estado_invalido.
      const error = capturarComision(() =>
        bl.servicioB.confirmarBorrador({
          liquidacionId: borrador.liquidacion.id,
          fingerprint: borrador.liquidacion.fingerprint,
          actorUsuarioId: PLAYERO,
        }),
      );
      expect(error.status).toBe(409);
      expect(error.code).toBe('estado_invalido');

      // Sin duplicación de eventos ni mutación del snapshot.
      const eventos = bl.dbA
        .prepare('SELECT evento FROM liquidacion_comision_evento ORDER BY created_at ASC')
        .all() as { evento: string }[];
      expect(eventos.map((e) => e.evento)).toEqual(['generada', 'confirmada']);
      const vistaB = new LiquidacionComisionRepository(bl.dbB).buscarPorIdVigente(
        borrador.liquidacion.id,
      )!;
      expect(vistaB.estado).toBe('confirmada');
      expect(vistaB.monto_items_centavos).toBe(4000);
    } finally {
      bl.cerrar();
    }
  });

  it('Dado carrera de generaciones por el mismo ajuste con 2 conexiones reales Cuando el ganador reserva y el perdedor envía su fingerprint previo Entonces perdedor 409 sin filas ni reservas duplicadas y la nueva preview permite generar sin el ajuste', () => {
    const bl = abrir();
    try {
      configurar(bl.dbA, 40); // pag-x 25.000 → comisión 10.000
      insertarPago(bl.dbA, { id: 'pag-x', turnoId: 'tur-1', monto: 25000 });
      insertarMovimiento(bl.dbA, { id: 'mov-x', pagoId: 'pag-x', fecha: '2026-11-02' });
      const liq1 = generar(bl.servicioA, '2026-11-01', '2026-11-10');
      bl.servicioA.confirmarBorrador({
        liquidacionId: liq1.liquidacion.id,
        fingerprint: liq1.liquidacion.fingerprint,
        actorUsuarioId: PLAYERO,
      });
      anularPago(bl.dbA, 'pag-x', ANULADO_UNO);
      insertarPago(bl.dbA, { id: 'pag-z', turnoId: 'tur-1', monto: 10000 });
      insertarMovimiento(bl.dbA, { id: 'mov-z', pagoId: 'pag-z', fecha: '2026-11-25' });

      // Ambas conexiones pre-visualizan ANTES de la reserva (estado determinista).
      const fpPerdedor = preview(bl.servicioB, '2026-11-21', '2026-11-30').fingerprint;
      const fpGanador = preview(bl.servicioA, '2026-11-11', '2026-11-20').fingerprint;

      // GANADOR (conexión A): genera → reserva exclusiva commiteada.
      const liq2 = generar(bl.servicioA, '2026-11-11', '2026-11-20', fpGanador);
      expect(liq2.ajustes).toHaveLength(1);

      // PERDEDOR (conexión B, fingerprint previo a la reserva): la re-derivación
      // intra-tx con BEGIN IMMEDIATE real difiere → 409 SIN persistir nada.
      const error = capturarComision(() =>
        generar(bl.servicioB, '2026-11-21', '2026-11-30', fpPerdedor),
      );
      expect(error.status).toBe(409);
      expect(error.code).toBe('preview_desactualizado');
      expect(contarVigentes(bl.dbB, 'liquidacion_comision')).toBe(2);
      const reservas = dbContarReservas(bl.dbB);
      expect(reservas).toBe(1); // única reserva (índice parcial, D12)

      // Nueva preview en la conexión del perdedor + generación exitosa SIN el ajuste.
      const pvFresca = preview(bl.servicioB, '2026-11-21', '2026-11-30');
      expect(pvFresca.ajustes).toHaveLength(0);
      const liq3 = generar(bl.servicioB, '2026-11-21', '2026-11-30', pvFresca.fingerprint);
      expect(liq3.ajustes).toHaveLength(0);
      expect(liq3.items.map((i) => i.pago_id)).toEqual(['pag-z']);
      expect(dbContarReservas(bl.dbB)).toBe(1);
    } finally {
      bl.cerrar();
    }
  });

  it('Dado una conexión real sosteniendo BEGIN IMMEDIATE Cuando la otra confirma Entonces SQLite impone escritor único (busy crudo, UnitOfWork sin retry) y tras el rollback el reintento confirma', () => {
    const bl = abrir();
    try {
      configurar(bl.dbA, 40);
      insertarPago(bl.dbA, { id: 'pag-a', turnoId: 'tur-1', monto: 10000 });
      insertarMovimiento(bl.dbA, { id: 'mov-a', pagoId: 'pag-a', fecha: '2026-11-05' });
      const borrador = generar(bl.servicioA);

      // El escritor B sostiene el bloqueo (escritor único real de SQLite).
      bl.dbB.exec('BEGIN IMMEDIATE');
      const crudo = capturarCualquiera(() =>
        bl.servicioA.confirmarBorrador({
          liquidacionId: borrador.liquidacion.id,
          fingerprint: borrador.liquidacion.fingerprint,
          actorUsuarioId: PLAYERO,
        }),
      );
      // Comportamiento documentado del UnitOfWork: SQLITE_BUSY sin retry →
      // error crudo de node:sqlite (errcode 5, "database is locked"), NO del dominio.
      expect(crudo).toBeInstanceOf(Error);
      expect(crudo).not.toBeInstanceOf(ComisionError);
      expect((crudo as { errcode?: number }).errcode).toBe(5);
      expect((crudo as Error).message).toContain('database is locked');
      // Nada quedó a medias: sigue borrador con un solo evento.
      const preCheck = new LiquidacionComisionRepository(bl.dbA).buscarPorIdVigente(
        borrador.liquidacion.id,
      )!;
      expect(preCheck.estado).toBe('borrador');
      expect(contarTotal(bl.dbA, 'liquidacion_comision_evento')).toBe(1);

      // El escritor libera y el reintento confirma (reintentable).
      bl.dbB.exec('ROLLBACK');
      const confirmada = bl.servicioA.confirmarBorrador({
        liquidacionId: borrador.liquidacion.id,
        fingerprint: borrador.liquidacion.fingerprint,
        actorUsuarioId: PLAYERO,
      });
      expect(confirmada.liquidacion.estado).toBe('confirmada');
      expect(contarTotal(bl.dbA, 'liquidacion_comision_evento')).toBe(2);
    } finally {
      bl.cerrar();
    }
  });
});

describe('comisiones — casos anti-duplicación (C-13, task 7.2, R11)', () => {
  let db: DatabaseSync;
  let servicio: ComisionesLiquidacionesService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarBase(db);
    servicio = new ComisionesLiquidacionesService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado cobro ya liquidado por un profesional Cuando otro profesional intenta liquidar el MISMO cobro Entonces preview lo descarta como cobro_ya_liquidado y el guard/UNIQUE lo rechaza', () => {
    // Configurar ambos profesionales
    configurar(db, 40);
    new ComisionesConfigService(db).guardarConfiguracion({
      profesional_id: 'prof-2',
      pct_general: 50,
      tratamientos: [],
    });

    // Pago pag-dup sobre tur-1 (prof-1)
    insertarPago(db, { id: 'pag-dup', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-dup', pagoId: 'pag-dup', fecha: '2026-11-05' });

    // Liquidación para prof-1 captura pag-dup
    const liqProf1 = generar(servicio, '2026-11-01', '2026-11-10');
    expect(liqProf1.items.map((i) => i.pago_id)).toEqual(['pag-dup']);

    // Reasignar tur-1 a prof-2 (para que entre en su rango elegible de turnos)
    db.prepare(`UPDATE turno SET profesional_id = 'prof-2' WHERE id = 'tur-1'`).run();

    // Preview de prof-2: pag-dup es descartado por cobro_ya_liquidado (guard D7)
    const pvProf2 = servicio.calcularPreview('prof-2', '2026-11-01', '2026-11-10');
    expect(pvProf2.descartes).toContainEqual({
      pago_id: 'pag-dup',
      motivo: 'cobro_ya_liquidado',
    });
    expect(pvProf2.pagos_ya_liquidados).toEqual(['pag-dup']);
    expect(pvProf2.items).toHaveLength(0);

    // Si prof-2 intenta generar con un ítem duplicado o sin contenido liquidable:
    // 1) Sin contenido liquidable -> validacion
    const errVacio = capturarComision(() =>
      servicio.generarBorrador({
        profesionalId: 'prof-2',
        desde: '2026-11-01',
        hasta: '2026-11-10',
        fingerprint: pvProf2.fingerprint,
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(errVacio.code).toBe('validacion');

    // 2) Si se intenta insertar directamente en BD con otro liquidacion_id: UNIQUE parcial aborta
    const itemsRepo = new LiquidacionItemRepository(db);
    expect(() =>
      itemsRepo.insert({
        id: 'item-dup-prof2',
        liquidacion_id: 'liq-fantasma',
        pago_id: 'pag-dup',
        turno_id: 'tur-1',
        fecha_contable: '2026-11-05',
        monto_cobro_centavos: 10000,
        pct_aplicado: 50,
        regla_aplicada: 'general',
        monto_comision_centavos: 5000,
      }),
    ).toThrow();
  });

  it('Dado período repetido para el mismo profesional Cuando intento generar de nuevo Entonces 409 periodo_ya_liquidado y persiste UNA cabecera', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-p1', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-p1', pagoId: 'pag-p1', fecha: '2026-11-05' });

    const liq = generar(servicio, '2026-11-01', '2026-11-10');
    expect(liq.liquidacion.estado).toBe('borrador');

    const errRepetido = capturarComision(() =>
      servicio.generarBorrador({
        profesionalId: 'prof-1',
        desde: '2026-11-01',
        hasta: '2026-11-10',
        fingerprint: 'a'.repeat(64),
        actorUsuarioId: PLAYERO,
      }),
    );
    expect(errRepetido.status).toBe(409);
    expect(errRepetido.code).toBe('periodo_ya_liquidado');
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(1);
  });

  it('Dado períodos solapados para el mismo profesional (Q7) Cuando genero ambos Entonces coexisten y cada cobro genera UN SOLO ítem', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-sol-1', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-sol-1', pagoId: 'pag-sol-1', fecha: '2026-11-08' });
    insertarPago(db, { id: 'pag-sol-2', turnoId: 'tur-2', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-sol-2', pagoId: 'pag-sol-2', fecha: '2026-11-15' });

    // Primera liquidación: 01-10 (toma pag-sol-1)
    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    expect(liq1.items.map((i) => i.pago_id)).toEqual(['pag-sol-1']);

    // Período solapado: 05-20 (solapa del 05 al 10)
    const pvSol = servicio.calcularPreview('prof-1', '2026-11-05', '2026-11-20');
    expect(pvSol.descartes).toContainEqual({
      pago_id: 'pag-sol-1',
      motivo: 'cobro_ya_liquidado',
    });
    expect(pvSol.items.map((i) => i.pago_id)).toEqual(['pag-sol-2']);

    const liq2 = generar(servicio, '2026-11-05', '2026-11-20', pvSol.fingerprint);
    expect(liq2.items.map((i) => i.pago_id)).toEqual(['pag-sol-2']);

    // Ambas cabeceras conviven vigentes (Q7 ratificada)
    expect(contarVigentes(db, 'liquidacion_comision')).toBe(2);
    // Cada cobro tiene un único ítem activo
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM liquidacion_comision_item WHERE pago_id = 'pag-sol-1' AND deleted_at IS NULL`).get() as { n: number }).n,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM liquidacion_comision_item WHERE pago_id = 'pag-sol-2' AND deleted_at IS NULL`).get() as { n: number }).n,
    ).toBe(1);
  });

  it('Dado dos previews idénticos Cuando consulto BD Entonces no se generan cabeceras, ítems ni eventos (preview no persiste)', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-pv', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-pv', pagoId: 'pag-pv', fecha: '2026-11-05' });

    const pv1 = servicio.calcularPreview('prof-1', '2026-11-01', '2026-11-30');
    const pv2 = servicio.calcularPreview('prof-1', '2026-11-01', '2026-11-30');

    expect(pv1.fingerprint).toBe(pv2.fingerprint);
    expect(pv1.totales).toEqual(pv2.totales);
    expect(pv1.items).toEqual(pv2.items);

    // Cero persistencia
    expect(contarTotal(db, 'liquidacion_comision')).toBe(0);
    expect(contarTotal(db, 'liquidacion_comision_item')).toBe(0);
    expect(contarTotal(db, 'liquidacion_comision_ajuste')).toBe(0);
    expect(contarTotal(db, 'liquidacion_comision_evento')).toBe(0);
  });

  it('Dado pago anulado post-confirmación Cuando se genera borrador Entonces el ajuste se reserva UNA sola vez (segunda generación con fingerprint previo recibe 409 preview_desactualizado) y la confirmada original queda intacta', () => {
    configurar(db, 40); // 10.000 @ 40% = 4.000
    insertarPago(db, { id: 'pag-anul', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-anul', pagoId: 'pag-anul', fecha: '2026-11-02' });

    // Confirmar liquidación original
    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    servicio.confirmarBorrador({
      liquidacionId: liq1.liquidacion.id,
      fingerprint: liq1.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });

    // Anular pago después de confirmar
    anularPago(db, 'pag-anul', ANULADO_UNO);

    // Previews previas a la reserva (ambas ven el ajuste pendiente)
    const fpPrevio = servicio.calcularPreview('prof-1', '2026-11-11', '2026-11-20').fingerprint;
    const fpPrevio2 = servicio.calcularPreview('prof-1', '2026-11-21', '2026-11-30').fingerprint;

    // Generación 1: reserva el ajuste exitosamente
    const liq2 = generar(servicio, '2026-11-11', '2026-11-20', fpPrevio);
    expect(liq2.ajustes).toHaveLength(1);
    expect(liq2.ajustes[0]!.estado_ajuste).toBe('reservado');
    expect(liq2.ajustes[0]!.monto_ajuste_centavos).toBe(4000);

    // Generación 2 con fingerprint previo a la reserva: 409 preview_desactualizado
    const errStale = capturarComision(() =>
      generar(servicio, '2026-11-21', '2026-11-30', fpPrevio2),
    );
    expect(errStale.status).toBe(409);
    expect(errStale.code).toBe('preview_desactualizado');

    // Exactamente UNA fila reservada en toda la base
    const reservas = db
      .prepare(`SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL`)
      .get() as { n: number };
    expect(reservas.n).toBe(1);

    // La liquidación confirmada original permanece completamente inmutable (Q4/D4)
    const liqOriginal = new LiquidacionComisionRepository(db).buscarPorIdVigente(liq1.liquidacion.id)!;
    expect(liqOriginal.estado).toBe('confirmada');
    expect(liqOriginal.monto_items_centavos).toBe(4000);
    expect(liqOriginal.monto_total_centavos).toBe(4000);
    expect(liqOriginal.saldo_compensacion_centavos).toBe(0);
  });

  it('Dado borrador con ajuste reservado Cuando se da de baja lógica Entonces la reserva se libera y un nuevo borrador puede reservar el ajuste', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-lib', turnoId: 'tur-1', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-lib', pagoId: 'pag-lib', fecha: '2026-11-02' });

    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    servicio.confirmarBorrador({
      liquidacionId: liq1.liquidacion.id,
      fingerprint: liq1.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    anularPago(db, 'pag-lib', ANULADO_UNO);

    // Generar borrador B1 que reserva el ajuste
    const b1 = generar(servicio, '2026-11-11', '2026-11-20');
    expect(b1.ajustes).toHaveLength(1);
    expect(b1.ajustes[0]!.estado_ajuste).toBe('reservado');

    // Dar de baja lógica B1 (cabecera, items y liberación de ajustes en misma tx)
    new LiquidacionComisionRepository(db).softDelete(b1.liquidacion.id);
    new LiquidacionItemRepository(db).darDeBajaPorLiquidacion(b1.liquidacion.id);
    new LiquidacionAjusteRepository(db).liberarPorLiquidacion(b1.liquidacion.id);

    // La reserva previa quedó con deleted_at
    const reservasActivas = db
      .prepare(`SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste WHERE estado_ajuste = 'reservado' AND deleted_at IS NULL`)
      .get() as { n: number };
    expect(reservasActivas.n).toBe(0);

    // Nueva preview: el ajuste vuelve a estar pendiente
    const pvNueva = servicio.calcularPreview('prof-1', '2026-11-11', '2026-11-20');
    expect(pvNueva.ajustes).toHaveLength(1);
    expect(pvNueva.ajustes[0]!.pago_id).toBe('pag-lib');
    expect(pvNueva.ajustes[0]!.monto_ajuste_centavos).toBe(4000);

    // Nuevo borrador B2 se genera y reserva exitosamente
    const b2 = generar(servicio, '2026-11-11', '2026-11-20', pvNueva.fingerprint);
    expect(b2.ajustes).toHaveLength(1);
    expect(b2.ajustes[0]!.estado_ajuste).toBe('reservado');
    expect(b2.ajustes[0]!.liquidacion_id).toBe(b2.liquidacion.id);
  });

  it('Dado saldo restante Cuando se arrastra como saldo_arrastre en período posterior Entonces neto negativo permitido solo por ajustes y sin pagos negativos', () => {
    configurar(db, 40);
    insertarPago(db, { id: 'pag-arr', turnoId: 'tur-1', monto: 25000 }); // comisión 10.000
    insertarMovimiento(db, { id: 'mov-arr', pagoId: 'pag-arr', fecha: '2026-11-02' });

    const liq1 = generar(servicio, '2026-11-01', '2026-11-10');
    servicio.confirmarBorrador({
      liquidacionId: liq1.liquidacion.id,
      fingerprint: liq1.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    anularPago(db, 'pag-arr', ANULADO_UNO);

    // Período 2: cobro nuevo de 10.000 (comisión 4.000) contra ajuste de 10.000
    insertarPago(db, { id: 'pag-cobro2', turnoId: 'tur-2', monto: 10000 });
    insertarMovimiento(db, { id: 'mov-cobro2', pagoId: 'pag-cobro2', fecha: '2026-11-15' });

    const liq2 = generar(servicio, '2026-11-11', '2026-11-20');
    expect(liq2.liquidacion.monto_items_centavos).toBe(4000);
    expect(liq2.liquidacion.monto_ajustes_centavos).toBe(10000);
    expect(liq2.liquidacion.monto_total_centavos).toBe(-6000);

    const conf2 = servicio.confirmarBorrador({
      liquidacionId: liq2.liquidacion.id,
      fingerprint: liq2.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    expect(conf2.liquidacion.estado).toBe('confirmada');
    expect(conf2.liquidacion.monto_total_centavos).toBe(-6000);
    expect(conf2.liquidacion.saldo_compensacion_centavos).toBe(6000);
    expect(conf2.ajustes[0]!.estado_ajuste).toBe('consumido');
    expect(conf2.ajustes[0]!.monto_compensado_centavos).toBe(4000);

    // No se generan pagos negativos automáticos (P1): tabla pago sigue con exactamente 2 filas
    expect(contarTotal(db, 'pago')).toBe(2);

    // Período 3: el resto pendiente (6.000) se detecta como saldo_arrastre
    insertarPago(db, { id: 'pag-cobro3', turnoId: 'tur-1', monto: 20000 }); // comisión 8.000
    insertarMovimiento(db, { id: 'mov-cobro3', pagoId: 'pag-cobro3', fecha: '2026-12-05' });

    const pv3 = servicio.calcularPreview('prof-1', '2026-12-01', '2026-12-10');
    expect(pv3.ajustes).toHaveLength(1);
    expect(pv3.ajustes[0]!.tipo_ajuste).toBe('saldo_arrastre');
    expect(pv3.ajustes[0]!.monto_ajuste_centavos).toBe(6000);
    expect(pv3.totales.monto_items_centavos).toBe(8000);
    expect(pv3.totales.monto_ajustes_centavos).toBe(6000);
    expect(pv3.totales.monto_total_centavos).toBe(2000);

    const liq3 = generar(servicio, '2026-12-01', '2026-12-10', pv3.fingerprint);
    expect(liq3.ajustes[0]!.tipo_ajuste).toBe('saldo_arrastre');
    const conf3 = servicio.confirmarBorrador({
      liquidacionId: liq3.liquidacion.id,
      fingerprint: liq3.liquidacion.fingerprint,
      actorUsuarioId: PLAYERO,
    });
    expect(conf3.ajustes[0]!.monto_compensado_centavos).toBe(6000);
    expect(conf3.liquidacion.saldo_compensacion_centavos).toBe(0);
    expect(conf3.liquidacion.monto_total_centavos).toBe(2000);
    expect(contarTotal(db, 'pago')).toBe(3); // ningún pago negativo
  });
});
