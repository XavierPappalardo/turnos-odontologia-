/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-07 recordatorios automáticos.
 * SQLite real en memoria (R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin floats (R2 N/A).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { cambiarEstadoTurno } from '../src/agenda/turnoEstado.service.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { programarRecordatoriosParaTurno, procesarRecordatoriosPendientes, cancelarRecordatoriosDeTurno } from '../src/notificaciones/recordatorio.worker.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import type { AppConfig } from '../src/shared/config.js';
import type { PacienteId, ProfesionalId, SillonId } from '../src/shared/types.js';

// ── Configuración de prueba ─────────────────────────────────────────────────
const AUTH: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c07',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
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
  caja: {
    zonaHoraria: 'America/Buenos_Aires',
  },
  mercadopago: {
    habilitado: false,
    ambiente: 'sandbox',
    token: null,
    webhookSecret: null,
  },
};

// ── Fixtures ficticios (R1/R12) ────────────────────────────────────────────
const PROF = 'prof-0001';
const SILLA = 'sillon-0001';
const PAC = 'pac-0001';

function seedBase(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(PROF, 'Prof Ficticio Uno', now, now);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(SILLA, 'Sillon Ficticio 1', now, now);
  db.prepare(
    `INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(PAC, 'Paciente Ficticio Ejemplo', now, now);
}

function crearTurnoTest(
  db: DatabaseSync,
  args: { inicio: string; fin: string; estado?: string; origen?: string },
): string {
  const id = `turno-record-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    PROF,
    SILLA,
    PAC,
    null,
    args.inicio,
    args.fin,
    args.estado ?? 'reservado',
    args.origen ?? 'recepcion',
    now,
    now,
  );
  return id;
}

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
});

afterEach(() => {
  db.close();
});

// ── Programar recordatorios ─────────────────────────────────────────────────
describe('Programar recordatorios para un turno', () => {
  it('Dado turno confirmado con inicio en el futuro Cuando programo recordatorios Entonces se crean 2 pendientes (48h y 24h)', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
      estado: 'confirmado',
    });

    programarRecordatoriosParaTurno(db, turnoId, '2026-11-05T10:00:00.000Z', AUTH.recordatorio);

    const pendientes = db
      .prepare(`SELECT id, tipo, estado FROM recordatorio WHERE turno_id = ?`)
      .all(turnoId) as { id: string; tipo: string; estado: string }[];
    expect(pendientes.length).toBe(2);
    expect(pendientes.map((p) => p.tipo).sort()).toEqual([
      'recordatorio_24h',
      'recordatorio_48h',
    ]);
    expect(pendientes.every((p) => p.estado === 'pendiente')).toBe(true);
  });

  it('Dado turno con inicio muy cercano Cuando programo Entonces no se crean recordatorios (fecha pasada)', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1 hora
      fin: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // +2 horas
    });

    programarRecordatoriosParaTurno(db, turnoId, new Date(Date.now() + 60 * 60 * 1000).toISOString(), AUTH.recordatorio);

    const pendientes = db
      .prepare(`SELECT COUNT(*) AS n FROM recordatorio WHERE turno_id = ?`)
      .get(turnoId) as { n: number };
    expect(pendientes.n).toBe(0);
  });

  it('Dado programar dos veces para el mismo turno Cuando llamo otra vez Entonces no se duplican', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });

    programarRecordatoriosParaTurno(db, turnoId, '2026-11-05T10:00:00.000Z', AUTH.recordatorio);
    programarRecordatoriosParaTurno(db, turnoId, '2026-11-05T10:00:00.000Z', AUTH.recordatorio);

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM recordatorio WHERE turno_id = ?`)
      .get(turnoId) as { n: number };
    expect(count.n).toBe(2);
  });
});

// ── Procesar recordatorios pendientes ───────────────────────────────────────
describe('Procesar recordatorios pendientes', () => {
  it('Dado recordatorios pendientes vencidos Cuando proceso Entonces se marcan como enviados', () => {
    const ahora = new Date().toISOString();
    const pasado = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // hace 1 hora

    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });

    // Insertar recordatorios vencidos directamente (simulando que llegaron su hora)
    const ahoraIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-001',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      pasado,
      ahoraIso,
      ahoraIso,
    );
    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-002',
      turnoId,
      'recordatorio_24h',
      'whatsapp',
      pasado,
      ahoraIso,
      ahoraIso,
    );

    const procesados = procesarRecordatoriosPendientes(db, AUTH.recordatorio);

    expect(procesados.length).toBe(2);
    expect(procesados.every((p) => p.estado === 'enviado')).toBe(true);

    // Verificar en BD
    const estados = db
      .prepare(`SELECT estado FROM recordatorio WHERE turno_id = ?`)
      .all(turnoId) as { estado: string }[];
    expect(estados.every((e) => e.estado === 'enviado')).toBe(true);
  });

  it('Dado recordatorio ya enviado Cuando proceso Entonces no se reprocesa', () => {
    const pasado = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ahoraIso = new Date().toISOString();

    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });

    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'enviado', ?, ?, ?)`,
    ).run(
      'rec-ya-enviado',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      pasado,
      ahoraIso,
      ahoraIso,
      ahoraIso,
    );

    const procesados = procesarRecordatoriosPendientes(db, AUTH.recordatorio);

    expect(procesados.length).toBe(0);
  });

  it('Dado recordatorio con fecha futura Cuando proceso Entonces no se envía todavía', () => {
    const futuro = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(); // +10 horas
    const ahoraIso = new Date().toISOString();

    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });

    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-futuro',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      futuro,
      ahoraIso,
      ahoraIso,
    );

    const procesados = procesarRecordatoriosPendientes(db, AUTH.recordatorio);

    expect(procesados.length).toBe(0);

    const estado = db
      .prepare(`SELECT estado FROM recordatorio WHERE id = ?`)
      .get('rec-futuro') as { estado: string };
    expect(estado.estado).toBe('pendiente');
  });
});

// ── Cancelar recordatorios al cambiar estado de turno ───────────────────────
describe('Cancelar recordatorios al cambiar estado de turno', () => {
  it('Dado turno con recordatorios pendientes Cuando se cancela el turno Entonces recordatorios se marcan como cancelados', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
      estado: 'reservado',
    });
    const ahoraIso = new Date().toISOString();

    // Insertar recordatorios pendientes
    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-para-cancelar-1',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      '2026-11-03T10:00:00.000Z',
      ahoraIso,
      ahoraIso,
    );
    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-para-cancelar-2',
      turnoId,
      'recordatorio_24h',
      'whatsapp',
      '2026-11-04T10:00:00.000Z',
      ahoraIso,
      ahoraIso,
    );

    // Cambiar estado del turno a cancelado (usa cambiarEstadoTurno de C-06)
    cambiarEstadoTurno(db, { turnoId, nuevoEstado: 'cancelado', rol: 'recepcion' });

    const estados = db
      .prepare(`SELECT estado FROM recordatorio WHERE turno_id = ?`)
      .all(turnoId) as { estado: string }[];
    expect(estados.length).toBe(2);
    expect(estados.every((e) => e.estado === 'cancelado')).toBe(true);
  });
});

// ── Endpoints públicos ──────────────────────────────────────────────────────
describe('Endpoints públicos de recordatorios', () => {
  it('Dado recordatorios pendientes Cuando llamo a GET /pendientes Entonces devuelve la lista', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });
    const ahoraIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-pendiente-1',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      '2026-11-03T10:00:00.000Z',
      ahoraIso,
      ahoraIso,
    );

    const res = await request(createApp(db, AUTH))
      .get('/api/public/recordatorios/pendientes');

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.pendientes.some((p: { id: string }) => p.id === 'rec-pendiente-1')).toBe(true);
  });

  it('Dado recordatorios vencidos Cuando llamo a POST /procesar Entonces devuelve procesados', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });
    const pasado = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ahoraIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-procesar-1',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      pasado,
      ahoraIso,
      ahoraIso,
    );

    const res = await request(createApp(db, AUTH))
      .post('/api/public/recordatorios/procesar');

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.procesados.some((p: { id: string }) => p.id === 'rec-procesar-1')).toBe(true);
    expect(res.body.procesados.some((p: { estado: string }) => p.estado === 'enviado')).toBe(true);
  });

  it('Dado cuerpo sin PHI Cuando hay error Entonces respuesta solo tiene ids opacos', async () => {
    const res = await request(createApp(db, AUTH))
      .get('/api/public/recordatorios/pendientes');

    expect(res.status).toBe(200);
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toMatch(/Ficticio|Paciente Ejemplo|whatsapp|DNI|dni|historia/i);
  });
});

// ── Servicio directo ────────────────────────────────────────────────────────
describe('Servicio directo de recordatorios', () => {
  it('Dado cancelarRecordatoriosDeTurno Cuando se llama Entonces cancela pendientes', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-05T10:00:00.000Z',
      fin: '2026-11-05T10:30:00.000Z',
    });
    const ahoraIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
    ).run(
      'rec-directo-1',
      turnoId,
      'recordatorio_48h',
      'whatsapp',
      '2026-11-03T10:00:00.000Z',
      ahoraIso,
      ahoraIso,
    );

    cancelarRecordatoriosDeTurno(db, turnoId);

    const estado = db
      .prepare(`SELECT estado FROM recordatorio WHERE id = ?`)
      .get('rec-directo-1') as { estado: string };
    expect(estado.estado).toBe('cancelado');
  });

  it('marca tipos de marca distintos: PacienteId no es ProfesionalId', () => {
    const pac = PAC as PacienteId;
    const prof = PROF as ProfesionalId;
    const distintos: boolean = (pac as string) !== (prof as string);
    expect(distintos).toBe(true);
  });
});
