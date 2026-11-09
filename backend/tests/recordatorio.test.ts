/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-07 recordatorios automáticos.
 * SQLite real en memoria (R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin floats (R2 N/A).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { hashToken } from '../src/auth/tokens.js';
import { cambiarEstadoTurno } from '../src/agenda/turnoEstado.service.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import {
  programarRecordatoriosParaTurno,
  programarRecordatoriosSeguro,
  programarRecordatoriosDeTurnosFuturos,
  procesarRecordatoriosPendientes,
  cancelarRecordatoriosDeTurno,
} from '../src/notificaciones/recordatorio.worker.js';
import {
  leerRecordatoriosDeTurno,
  sembrarRecordatorio,
} from './helpers/agenda-fixtures.js';
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
  chatbot: {
    simuladoHabilitado: true,
    sessionTtlSeconds: 1800,
    maxIntentosInvalidos: 5,
    rateMax: 1000,
    rateWindowSeconds: 60,
  },
  portalPaciente: { tokenTtlSeconds: 604800, rateMax: 1000, rateWindowSeconds: 60 },
  recuperacionCobranza: {
    habilitado: true,
    inactividadDias: 180,
    recuperacionVentanaHoras: 720,
    cobranzaVentanaHoras: 168,
    maxContactosPorEjecucion: 200,
  },
  solicitudResena: {
    habilitado: true,
    linkResena: 'https://ejemplo.local/resena-placeholder',
    canalPredeterminado: 'whatsapp',
    demoraMinutos: 0,
    ventanaDedupeHoras: 8760,
    maxSolicitudesPorLote: 200,
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
    // Fechas relativas: el worker solo programa hitos futuros (spec C-07), por lo
    // que un literal absoluto caduca en cuanto pasa la fecha y el test se rompe.
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const fin = new Date(baseMs + 30 * 60 * 1000).toISOString();
    const turnoId = crearTurnoTest(db, { inicio, fin, estado: 'confirmado' });

    programarRecordatoriosParaTurno(db, turnoId, inicio, AUTH.recordatorio);

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
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const fin = new Date(baseMs + 30 * 60 * 1000).toISOString();
    const turnoId = crearTurnoTest(db, { inicio, fin });

    programarRecordatoriosParaTurno(db, turnoId, inicio, AUTH.recordatorio);
    programarRecordatoriosParaTurno(db, turnoId, inicio, AUTH.recordatorio);

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM recordatorio WHERE turno_id = ?`)
      .get(turnoId) as { n: number };
    expect(count.n).toBe(2);
  });
});

// ── 1.x Wrapper best-effort de programación (c-07-fix) ────────────────────
const TRIGGER_FALLO =
  `CREATE TRIGGER fallo_programacion BEFORE INSERT ON recordatorio
   BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;`;

describe('Dado el wrapper programarRecordatoriosSeguro Cuando programa o falla Entonces no propaga el error', () => {
  it('1.1a Dado un turno futuro con config válida Cuando llamo al wrapper Entonces crea los dos pendientes', () => {
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const turnoId = crearTurnoTest(db, {
      inicio,
      fin: new Date(baseMs + 30 * 60 * 1000).toISOString(),
    });

    programarRecordatoriosSeguro(db, turnoId, inicio, AUTH.recordatorio);

    const filas = leerRecordatoriosDeTurno(db, turnoId);
    expect(filas.length).toBe(2);
    expect(filas.map((f) => f.tipo)).toEqual([
      'recordatorio_24h',
      'recordatorio_48h',
    ]);
    expect(filas.every((f) => f.estado === 'pendiente')).toBe(true);
    expect(filas.every((f) => f.canal === 'whatsapp')).toBe(true);
  });

  it('1.1b Dado un trigger SQLite que aborta el INSERT Cuando llamo al wrapper Entonces no lanza, no deja filas y el turno sigue existiendo', () => {
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const turnoId = crearTurnoTest(db, {
      inicio,
      fin: new Date(baseMs + 30 * 60 * 1000).toISOString(),
    });

    db.prepare(TRIGGER_FALLO).run();
    try {
      expect(() =>
        programarRecordatoriosSeguro(db, turnoId, inicio, AUTH.recordatorio),
      ).not.toThrow();
      expect(leerRecordatoriosDeTurno(db, turnoId).length).toBe(0);
      expect(new TurnoRepository(db).findById(turnoId)).toBeDefined();
    } finally {
      db.prepare('DROP TRIGGER fallo_programacion').run();
    }
  });

  it('1.3a Dado el wrapper invocado dos veces Cuando reprogramo el mismo turno Entonces siguen siendo dos filas', () => {
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const turnoId = crearTurnoTest(db, {
      inicio,
      fin: new Date(baseMs + 30 * 60 * 1000).toISOString(),
    });

    programarRecordatoriosSeguro(db, turnoId, inicio, AUTH.recordatorio);
    programarRecordatoriosSeguro(db, turnoId, inicio, AUTH.recordatorio);

    expect(leerRecordatoriosDeTurno(db, turnoId).length).toBe(2);
  });

  it('1.3b Dado un fallo de programación Cuando se registra Entonces el log sólo tiene turno_id y nombre de error', () => {
    const baseMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const inicio = new Date(baseMs).toISOString();
    const turnoId = crearTurnoTest(db, {
      inicio,
      fin: new Date(baseMs + 30 * 60 * 1000).toISOString(),
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    db.prepare(TRIGGER_FALLO).run();
    try {
      programarRecordatoriosSeguro(db, turnoId, inicio, AUTH.recordatorio);
    } finally {
      db.prepare('DROP TRIGGER fallo_programacion').run();
      spy.mockRestore();
    }

    const log = logs.join('\n');
    expect(log).toContain(turnoId);
    expect(log).toMatch(/error=[A-Za-z]+/);
    // Nunca el mensaje crudo de la excepción ni datos del paciente (R3).
    expect(log).not.toMatch(/fallo simulado/);
    expect(log).not.toMatch(/Ficticio|Paciente Ejemplo|DNI|dni|telefono|historia/i);
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
    cambiarEstadoTurno(
      db,
      { turnoId, nuevoEstado: 'cancelado', rol: 'recepcion' },
      AUTH.recordatorio,
    );

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

// ── Backfill operativo (c-07-fix) ───────────────────────────────────────────
describe('Backfill operativo (c-07-fix)', () => {
  const EN_MS = 24 * 60 * 60 * 1000;

  /** `inicio` a `dias` del ahora; `fin` siempre 30 min después del inicio. */
  function ficha(dias: number): { inicio: string; fin: string } {
    const inicioMs = Date.now() + dias * EN_MS;
    return {
      inicio: new Date(inicioMs).toISOString(),
      fin: new Date(inicioMs + 30 * 60 * 1000).toISOString(),
    };
  }

  it('5.1 Dado turnos de distintos estados Cuando listo futuros Entonces solo reservado/confirmado vigentes ordenados', () => {
    const reservadoId = crearTurnoTest(db, { ...ficha(3), estado: 'reservado' });
    const confirmadoId = crearTurnoTest(db, { ...ficha(7), estado: 'confirmado' });
    crearTurnoTest(db, { ...ficha(3), estado: 'cancelado' });
    crearTurnoTest(db, { ...ficha(-1), estado: 'reservado' });
    const eliminadoId = crearTurnoTest(db, { ...ficha(4), estado: 'reservado' });
    db.prepare(`UPDATE turno SET deleted_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      eliminadoId,
    );

    const turnos = new TurnoRepository(db).listarFuturosActivos(new Date().toISOString());
    const ids = turnos.map((t) => t.id);
    expect(ids.length).toBe(2);
    expect(ids).toContain(reservadoId);
    expect(ids).toContain(confirmadoId);
    expect(ids[0]).toBe(reservadoId); // +3 días antes que +7 (ASC)
  });

  it('Dado BD sin turnos Cuando listo futuros Entonces devuelve vacío', () => {
    expect(
      new TurnoRepository(db).listarFuturosActivos(new Date().toISOString()),
    ).toEqual([]);
  });

  it('5.3a Dado turnos futuros Cuando corro backfill Entonces se programan pendientes y devuelve la cantidad', () => {
    const inicioMs = Date.now() + 7 * EN_MS;
    const turnoFuturo = crearTurnoTest(db, {
      inicio: new Date(inicioMs).toISOString(),
      fin: new Date(inicioMs + 30 * 60 * 1000).toISOString(),
    });
    crearTurnoTest(db, {
      inicio: new Date(Date.now() - EN_MS).toISOString(),
      fin: new Date(Date.now() - EN_MS + 30 * 60 * 1000).toISOString(),
    });

    const procesados = programarRecordatoriosDeTurnosFuturos(
      db,
      AUTH.recordatorio,
      new Date().toISOString(),
    );

    expect(procesados).toBe(1); // solo el futuro (listarFuturosActivos excluye pasados)
    const filas = leerRecordatoriosDeTurno(db, turnoFuturo);
    expect(filas.length).toBe(2);
    expect(filas.every((f) => f.estado === 'pendiente')).toBe(true);
    const fila48h = filas.find((f) => f.tipo === 'recordatorio_48h');
    const fila24h = filas.find((f) => f.tipo === 'recordatorio_24h');
    expect(fila48h?.programado_para).toBe(
      new Date(inicioMs - 48 * 60 * 60 * 1000).toISOString(),
    );
    expect(fila24h?.programado_para).toBe(
      new Date(inicioMs - 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('5.3b Dado backfill repetido Cuando corro dos veces Entonces no duplica filas', () => {
    const turnoId = crearTurnoTest(db, ficha(3));

    const primera = programarRecordatoriosDeTurnosFuturos(
      db,
      AUTH.recordatorio,
      new Date().toISOString(),
    );
    const segunda = programarRecordatoriosDeTurnosFuturos(
      db,
      AUTH.recordatorio,
      new Date().toISOString(),
    );

    expect(primera).toBe(1);
    expect(segunda).toBe(1);
    expect(leerRecordatoriosDeTurno(db, turnoId).length).toBe(2);
  });
});

// ── Integración HTTP (c-07-fix) ─────────────────────────────────────────────
describe('Integración HTTP (c-07-fix)', () => {
  /** `inicio`/`fin` relativos: turno a `ms` del ahora, duración 30 min. */
  function fichaFutura(ms: number): { inicio: string; fin: string } {
    const inicioMs = Date.now() + ms;
    return {
      inicio: new Date(inicioMs).toISOString(),
      fin: new Date(inicioMs + 30 * 60 * 1000).toISOString(),
    };
  }

  /** Siembra un `turno_token` de acción `cancelar` (patrón de turno_token.test.ts). */
  function sembrarTokenCancelar(
    db: DatabaseSync,
    turnoId: string,
    tokenClaro: string,
  ): string {
    const id = `token-http-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO turno_token (id, turno_id, token_hash, accion, expires_at, usado_en, created_at, updated_at)
       VALUES (?, ?, ?, 'cancelar', ?, NULL, ?, ?)`,
    ).run(id, turnoId, hashToken(tokenClaro), expiresAt, now, now);
    return tokenClaro;
  }

  it('6.1 Dado pendiente vencido, pendiente futuro y enviado Cuando proceso por HTTP Entonces 200 con un único procesado y los otros dos conservan estado', async () => {
    const turnoId = crearTurnoTest(db, fichaFutura(7 * 24 * 60 * 60 * 1000));
    const vencido = sembrarRecordatorio(db, {
      turnoId,
      estado: 'pendiente',
      programadoPara: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const futuro = sembrarRecordatorio(db, {
      turnoId,
      tipo: 'recordatorio_24h',
      estado: 'pendiente',
      programadoPara: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const yaEnviado = sembrarRecordatorio(db, {
      turnoId,
      estado: 'enviado',
      enviadoEn: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const res = await request(createApp(db, AUTH))
      .post('/api/public/recordatorios/procesar');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.procesados[0].id).toBe(vencido);

    const filas = leerRecordatoriosDeTurno(db, turnoId);
    const estadoDe = (id: string): string =>
      filas.find((f) => f.id === id)?.estado ?? '';
    expect(estadoDe(vencido)).toBe('enviado');
    expect(estadoDe(futuro)).toBe('pendiente');
    expect(estadoDe(yaEnviado)).toBe('enviado');
  });

  it('6.2 Dado reserva online por HTTP Entonces 201 y lista 2 pendientes; cancelada por token Entonces 200 y los pendientes dejan de listarse', async () => {
    // (a) Reserva online por HTTP: el cableado post-commit (grupo 2) programa los hitos.
    const reserva = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        ...fichaFutura(7 * 24 * 60 * 60 * 1000),
      });
    expect(reserva.status).toBe(201);
    const turnoId = reserva.body.id as string;

    let res = await request(createApp(db, AUTH))
      .get('/api/public/recordatorios/pendientes');
    expect(res.status).toBe(200);
    const delTurno = res.body.pendientes.filter(
      (p: { turno_id: string }) => p.turno_id === turnoId,
    );
    expect(delTurno.length).toBe(2);

    // (b) Cancelación por token: los pendientes se cancelan y dejan de listarse.
    const token = sembrarTokenCancelar(db, turnoId, 'tok-c07-http-cancelar');
    const cancela = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/cancelar`)
      .query({ token });
    expect(cancela.status).toBe(200);
    expect(cancela.body.estado).toBe('cancelado');

    res = await request(createApp(db, AUTH))
      .get('/api/public/recordatorios/pendientes');
    expect(res.status).toBe(200);
    expect(
      res.body.pendientes.some(
        (p: { turno_id: string }) => p.turno_id === turnoId,
      ),
    ).toBe(false);
    expect(
      leerRecordatoriosDeTurno(db, turnoId).every(
        (f) => f.estado === 'cancelado',
      ),
    ).toBe(true);
  });

  it('6.3 Dado respuesta del GET /pendientes Cuando se lista Entonces no hay PHI y sólo campos operativos (ids/tipo/estado)', async () => {
    const turnoId = crearTurnoTest(db, fichaFutura(7 * 24 * 60 * 60 * 1000));
    sembrarRecordatorio(db, { turnoId, estado: 'pendiente' });

    const res = await request(createApp(db, AUTH))
      .get('/api/public/recordatorios/pendientes');

    expect(res.status).toBe(200);
    const cuerpo = JSON.stringify(res.body);
    // Sin PHI (R3): ni nombre ficticio del paciente ni marcadores de datos clínicos.
    expect(cuerpo).not.toMatch(/Ficticio|Paciente|DNI|dni|historia/i);
    // Sólo campos operativos: ids opacos, tipo, canal, estado y fechas.
    const permitidas = [
      'id',
      'turno_id',
      'tipo',
      'canal',
      'programado_para',
      'estado',
      'enviado_en',
      'created_at',
      'updated_at',
    ];
    for (const pendiente of res.body.pendientes as Record<string, unknown>[]) {
      expect(
        Object.keys(pendiente).every((k) => permitidas.includes(k)),
      ).toBe(true);
    }
  });
});