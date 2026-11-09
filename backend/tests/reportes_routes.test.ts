/**
 * C-14 tasks 7.1/7.3 y 8.1/8.3 — RBAC, error tipado y rutas HTTP de reportes.
 *
 * Escenarios con `supertest` sobre `createApp` (Express real, sin listen) y
 * SQLite REAL en memoria (R12). Datos estrictamente ficticios (R1). Verifica:
 * matriz de permisos, `ReportesError.toBody()` sin PHI, contratos JSON del
 * design D7, validación de rango, `401` sin token, `403` por rol y el alcance
 * forzado del profesional (design D10).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/shared/repository.js';
import { createApp } from '../src/shared/app.js';
import { ReportesError } from '../src/shared/errors.js';
import {
  puedeVerReportesOperativos,
  puedeVerReporteFacturacion,
} from '../src/shared/auth.js';
import type { Rol } from '../src/shared/types.js';
import { signToken } from '../src/auth/tokens.js';
import {
  insertarProfesional,
  insertarUsuario,
  seedReportesBase,
  sembrarMovimiento,
  sembrarPago,
  sembrarTurno,
  ZONA_TEST,
} from './helpers/reportes-fixtures.js';
import { APP_CONFIG, AUTH, bearer } from './helpers/agenda-fixtures.js';

const RANGO = 'desde=2026-11-01&hasta=2026-11-07';

function nuevaApp(): { db: DatabaseSync; app: ReturnType<typeof createApp> } {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  return { db, app: createApp(db, APP_CONFIG) };
}

function conBearer(roles: readonly Rol[]): string {
  return bearer(roles);
}

describe('RBAC de reportes (task 7.1)', () => {
  it('Dado cada rol del sistema Cuando pregunto por reportes operativos Entonces sólo recepción y administración pasan', () => {
    expect(puedeVerReportesOperativos('recepcion')).toBe(true);
    expect(puedeVerReportesOperativos('administracion')).toBe(true);
    expect(puedeVerReportesOperativos('profesional')).toBe(false);
    expect(puedeVerReportesOperativos(undefined)).toBe(false);
  });

  it('Dado cada rol del sistema Cuando pregunto por facturación Entonces sólo administración pasa', () => {
    expect(puedeVerReporteFacturacion('administracion')).toBe(true);
    expect(puedeVerReporteFacturacion('recepcion')).toBe(false);
    expect(puedeVerReporteFacturacion('profesional')).toBe(false);
    expect(puedeVerReporteFacturacion(undefined)).toBe(false);
  });

  it('Dado un ReportesError de validación Cuando serializo Entonces incluye error y detalle sin PHI', () => {
    const error = new ReportesError({
      status: 400,
      code: 'validacion',
      message: 'desde debe ser una fecha local YYYY-MM-DD existente',
      detalle: 'desde',
    });

    expect(error.toBody()).toEqual({
      error: 'validacion',
      detalle: 'desde',
    });
  });

  it('Dado un ReportesError de forbidden Cuando serializo Entonces sólo expone el código', () => {
    const error = new ReportesError({
      status: 403,
      code: 'forbidden',
      message: 'sin vínculo profesional',
      detalle: 'profesional_id',
    });

    expect(error.toBody()).toEqual({ error: 'forbidden' });
  });
});

/* ── Rutas HTTP (tasks 8.1/8.3) ── */

const PROF_A = 'prof-a';
const PROF_B = 'prof-b';
const SILLON_A = 'sillon-a';

function tokenPara(sub: string, roles: readonly Rol[]): string {
  const token = signToken(
    {
      sub,
      tenantId: 'test',
      roles,
      email: 'reportes@example.test',
      type: 'access',
      ttlSeconds: 900,
    },
    AUTH.jwtSecret,
  );
  return `Bearer ${token}`;
}

/** Usuario `profesional` con vínculo al profesional indicado. */
function usuarioProfesional(
  db: DatabaseSync,
  id: string,
  profesionalId: string | null,
): string {
  insertarUsuario(db, id);
  if (profesionalId !== null) {
    db.prepare('UPDATE usuario SET profesional_id = ? WHERE id = ?').run(
      profesionalId,
      id,
    );
  }
  return tokenPara(id, ['profesional']);
}

function sembrarCobro(
  db: DatabaseSync,
  clave: string,
  monto: number,
  fecha: string,
): void {
  const pagoId = `pago-ruta-${clave}`;
  sembrarPago(db, { id: pagoId, montoCentavos: monto, medio: 'efectivo' });
  sembrarMovimiento(db, {
    id: `mov-ruta-${clave}`,
    pagoId,
    tipo: 'cobro',
    montoCentavos: monto,
    fechaContable: fecha,
  });
}

describe('rutas de reportes — contratos (task 8.1)', () => {
  it('Dado un administrador y turnos del período Cuando pide ocupación Entonces responde 200 con el contrato D7', async () => {
    const { db, app } = nuevaApp();
    sembrarTurno(db, {
      id: 'ruta-ocup-1',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'confirmado',
    });
    sembrarTurno(db, {
      id: 'ruta-ocup-2',
      inicio: '2026-11-03T13:00:00.000Z',
      fin: '2026-11-03T14:30:00.000Z',
      estado: 'atendido',
    });

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({
      desde: '2026-11-01',
      hasta: '2026-11-07',
      granularidad: 'dia',
      zona_horaria: ZONA_TEST,
      total: { turnos: 2, minutos_ocupados: 120 },
    });
    expect(respuesta.body.series).toEqual([
      { clave: '2026-11-02', turnos: 1, minutos_ocupados: 30 },
      { clave: '2026-11-03', turnos: 1, minutos_ocupados: 90 },
    ]);
    expect(Array.isArray(respuesta.body.por_profesional)).toBe(true);
    expect(Array.isArray(respuesta.body.por_sillon)).toBe(true);
  });

  it('Dado un administrador y un cobro Cuando pide facturación Entonces responde 200 con neto y medios', async () => {
    const { db, app } = nuevaApp();
    sembrarCobro(db, 'fact-1', 50000, '2026-11-03');

    const respuesta = await request(app)
      .get(`/api/reportes/facturacion?${RANGO}`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.total).toEqual({
      cobros: { cantidad: 1, centavos: 50000 },
      anulaciones: { cantidad: 0, centavos: 0 },
      ingresos_netos_centavos: 50000,
      bolsillo_centavos: 50000,
      obra_social_centavos: 0,
    });
    expect(respuesta.body.por_medio).toEqual({
      efectivo: 50000,
      tarjeta: 0,
      transferencia: 0,
      mercadopago: 0,
      obra_social: 0,
    });
    expect(respuesta.body.series).toEqual([
      { clave: '2026-11-03', ingresos_netos_centavos: 50000 },
    ]);
  });

  it('Dado un administrador y turnos resueltos Cuando pide ausentismo Entonces responde 200 con la tasa entera', async () => {
    const { db, app } = nuevaApp();
    sembrarTurno(db, {
      id: 'ruta-aus-1',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'ausente',
    });
    sembrarTurno(db, {
      id: 'ruta-aus-2',
      inicio: '2026-11-02T14:00:00.000Z',
      fin: '2026-11-02T14:30:00.000Z',
      estado: 'atendido',
    });

    const respuesta = await request(app)
      .get(`/api/reportes/ausentismo?${RANGO}`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.total).toEqual({
      ausentes: 1,
      resueltos: 2,
      tasa_ausentismo_pct: 50,
    });
    expect(respuesta.body.series).toEqual([
      { clave: '2026-11-02', ausentes: 1, resueltos: 2, tasa_ausentismo_pct: 50 },
    ]);
  });

  it('Dado recepción Cuando pide ocupación y ausentismo Entonces ambos responden 200', async () => {
    const { app } = nuevaApp();
    const token = conBearer(['recepcion']);

    const ocupacion = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}`)
      .set('authorization', token);
    const ausentismo = await request(app)
      .get(`/api/reportes/ausentismo?${RANGO}`)
      .set('authorization', token);

    expect(ocupacion.status).toBe(200);
    expect(ausentismo.status).toBe(200);
  });

  it('Dado recepción Cuando pide facturación Entonces responde 403 forbidden', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/facturacion?${RANGO}`)
      .set('authorization', conBearer(['recepcion']));

    expect(respuesta.status).toBe(403);
    expect(respuesta.body).toEqual({ error: 'forbidden' });
  });

  it('Dado un profesional Cuando pide facturación Entonces responde 403 forbidden', async () => {
    const { db, app } = nuevaApp();
    const token = usuarioProfesional(db, 'user-prof-fact', PROF_A);

    const respuesta = await request(app)
      .get(`/api/reportes/facturacion?${RANGO}`)
      .set('authorization', token);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body).toEqual({ error: 'forbidden' });
  });
});

describe('rutas de reportes — validación y autenticación (task 8.1)', () => {
  it('Dado una consulta sin token Cuando pide cualquier reporte Entonces responde 401', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app).get(
      `/api/reportes/ocupacion?${RANGO}`,
    );

    expect(respuesta.status).toBe(401);
    expect(respuesta.body).toEqual({ error: 'no_autenticado' });
  });

  it('Dado desde con formato inválido Cuando pide el reporte Entonces responde 400 validacion sin PHI', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get('/api/reportes/ocupacion?desde=01-11-2026&hasta=2026-11-07')
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({ error: 'validacion', detalle: 'desde' });
    expect(JSON.stringify(respuesta.body)).not.toContain('pac-ficticio');
  });

  it('Dado una fecha inexistente Cuando pide el reporte Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get('/api/reportes/ocupacion?desde=2026-02-31&hasta=2026-03-07')
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({ error: 'validacion', detalle: 'desde' });
  });

  it('Dado un rango invertido Cuando pide el reporte Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get('/api/reportes/ausentismo?desde=2026-11-10&hasta=2026-11-01')
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({ error: 'validacion', detalle: 'rango' });
  });

  it('Dado un rango de más de 366 días Cuando pide el reporte Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get('/api/reportes/facturacion?desde=2025-11-01&hasta=2026-11-02')
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({ error: 'validacion', detalle: 'rango' });
  });

  it('Dado granularidad fuera del catálogo Cuando pide el reporte Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}&granularidad=trimestre`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({
      error: 'validacion',
      detalle: 'granularidad',
    });
  });

  it('Dado medio fuera del catálogo Cuando pide facturación Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/facturacion?${RANGO}&medio=cheque`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({ error: 'validacion', detalle: 'medio' });
  });

  it('Dado un profesional_id mal formado Cuando pide el reporte Entonces responde 400 validacion', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}&profesional_id=prof%20a`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toEqual({
      error: 'validacion',
      detalle: 'profesional_id',
    });
  });
});

describe('rutas de reportes — alcance del profesional (task 8.1)', () => {
  it('Dado un profesional vinculado Cuando consulta sin filtro Entonces recibe sólo sus métricas', async () => {
    const { db, app } = nuevaApp();
    insertarProfesional(db, PROF_B, 'MN-prof-b');
    sembrarTurno(db, {
      id: 'ruta-scope-a',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'atendido',
      profesionalId: PROF_A,
    });
    sembrarTurno(db, {
      id: 'ruta-scope-b',
      inicio: '2026-11-02T14:00:00.000Z',
      fin: '2026-11-02T15:00:00.000Z',
      estado: 'atendido',
      profesionalId: PROF_B,
    });
    const token = usuarioProfesional(db, 'user-prof-a', PROF_A);

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}`)
      .set('authorization', token);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.total).toEqual({ turnos: 1, minutos_ocupados: 30 });
    expect(respuesta.body.por_profesional).toEqual([
      { profesional_id: PROF_A, turnos: 1, minutos_ocupados: 30 },
    ]);
  });

  it('Dado un profesional vinculado Cuando pide otro profesional_id Entonces responde 403 forbidden', async () => {
    const { db, app } = nuevaApp();
    const token = usuarioProfesional(db, 'user-prof-a2', PROF_A);

    const respuesta = await request(app)
      .get(`/api/reportes/ausentismo?${RANGO}&profesional_id=${PROF_B}`)
      .set('authorization', token);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body).toEqual({ error: 'forbidden' });
  });

  it('Dado un profesional sin vínculo Cuando consulta Entonces responde 403 forbidden', async () => {
    const { db, app } = nuevaApp();
    const token = usuarioProfesional(db, 'user-prof-sin', null);

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}`)
      .set('authorization', token);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body).toEqual({ error: 'forbidden' });
  });

  it('Dado un profesional con otro rol operativo Cuando consulta Entonces el alcance operativo prevalece', async () => {
    const { db, app } = nuevaApp();
    const token = usuarioProfesional(db, 'user-prof-admin', PROF_A);

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}&profesional_id=${PROF_B}`)
      .set('authorization', tokenPara('user-prof-admin', [
        'profesional',
        'administracion',
      ]));

    expect(respuesta.status).toBe(200);
  });
});

describe('rutas de reportes — detalles del contrato (task 8.3)', () => {
  it('Dado parámetros desconocidos Cuando consulta Entonces se ignoran y responde 200', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/ocupacion?${RANGO}&foo=bar&orden=desc`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
  });

  it('Dado granularidad omitida Cuando consulta Entonces la respuesta informa dia', async () => {
    const { app } = nuevaApp();

    const respuesta = await request(app)
      .get(`/api/reportes/ausentismo?${RANGO}`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.granularidad).toBe('dia');
  });

  it('Dado movimientos en varios días Cuando consulta facturación Entonces series viene ordenada ascendente y sin ceros', async () => {
    const { db, app } = nuevaApp();
    sembrarCobro(db, 'orden-2', 2000, '2026-11-05');
    sembrarCobro(db, 'orden-1', 1000, '2026-11-02');

    const respuesta = await request(app)
      .get(`/api/reportes/facturacion?${RANGO}`)
      .set('authorization', conBearer(['administracion']));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.series).toEqual([
      { clave: '2026-11-02', ingresos_netos_centavos: 1000 },
      { clave: '2026-11-05', ingresos_netos_centavos: 2000 },
    ]);
  });
});
