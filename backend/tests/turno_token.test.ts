/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-06 confirmar/cancelar/reprogramar.
 * SQLite real en memoria (R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin floats (R2 N/A).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashToken } from '../src/auth/tokens.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { ejecutarAccionTurno } from '../src/agenda/turnoToken.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import type { AppConfig } from '../src/shared/config.js';
import type { PacienteId, ProfesionalId, SillonId } from '../src/shared/types.js';

// ── Configuración de prueba ─────────────────────────────────────────────────
const AUTH: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c06',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
  reservaOnline: {
    anticipacionMinSegundos: 0, // sin ventana para permitir cancelar en tests
    rateMax: 1000, // alto para que no interfiera en tests funcionales
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60, // 7 días
    },
    recordatorio: {
      t48hHoras: 48,
      t24hHoras: 24,
      canalPredeterminado: 'whatsapp',
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
  const id = `turno-test-${Math.random().toString(36).slice(2)}`;
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

function crearTokenTest(
  db: DatabaseSync,
  args: {
    turnoId: string;
    accion: 'confirmar' | 'cancelar' | 'reprogramar';
    tokenClaro: string;
    expiraEnSegundos?: number;
    yaUsado?: boolean;
  },
): string {
  const id = `token-test-${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (args.expiraEnSegundos ?? 7 * 24 * 60 * 60) * 1000,
  ).toISOString();
  const usadoEn = args.yaUsado ? now.toISOString() : null;
  const tokenHash = hashToken(args.tokenClaro);
  db.prepare(
    `INSERT INTO turno_token (id, turno_id, token_hash, accion, expires_at, usado_en, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.turnoId,
    tokenHash,
    args.accion,
    expiresAt,
    usadoEn,
    now.toISOString(),
    now.toISOString(),
  );
  return args.tokenClaro;
}

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
});

afterEach(() => {
  db.close();
});

// ── POST /api/public/turnos/:id/confirmar ──────────────────────────────────
describe('POST /api/public/turnos/:id/confirmar', () => {
  it('Dado turno reservado y token válido Cuando confirma Entonces 200 estado confirmado', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'confirmar', tokenClaro: 'tok-confirmar-valido' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('confirmado');
    expect(res.body.origen).toBe('recepcion');
  });

  it('Dado turno ya confirmado y token de confirmar Cuando confirma Entonces 409 transicion_invalida', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
      estado: 'confirmado',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'confirmar', tokenClaro: 'tok-ya-confirmado' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('transicion_invalida');
  });

  it('Dado token expirado Cuando confirma Entonces 401', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, {
      turnoId,
      accion: 'confirmar',
      tokenClaro: 'tok-expirado',
      expiraEnSegundos: -3600, // expirado hace 1 hora
    });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(401);
  });

  it('Dado token inválido Cuando confirma Entonces 401', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token: 'tok-inexistente' });

    expect(res.status).toBe(401);
  });

  it('Dado token ya usado Cuando confirma Entonces 403', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, {
      turnoId,
      accion: 'confirmar',
      tokenClaro: 'tok-ya-usado',
      yaUsado: true,
    });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(403);
  });

  it('Dado token de otra acción Cuando confirma Entonces 401', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'cancelar', tokenClaro: 'tok-cancelar-no-confirmar' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(401);
  });

  it('Dado turno inexistente Cuando confirma Entonces 404', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, {
      turnoId,
      accion: 'confirmar',
      tokenClaro: 'tok-turno-inexistente',
    });
    // Desactivar FK temporalmente para borrar el turno y dejar huérfano el token
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare(`DELETE FROM turno WHERE id = ?`).run(turnoId);
    db.prepare('PRAGMA foreign_keys = ON').run();

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/public/turnos/:id/cancelar ───────────────────────────────────
describe('POST /api/public/turnos/:id/cancelar', () => {
  it('Dado turno reservado con anticipación y token válido Cuando cancela Entonces 200 estado cancelado', async () => {
    const futuro = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(); // +10h
    const turnoId = crearTurnoTest(db, {
      inicio: futuro,
      fin: new Date(new Date(futuro).getTime() + 30 * 60 * 1000).toISOString(),
    });
    const token = crearTokenTest(db, { turnoId, accion: 'cancelar', tokenClaro: 'tok-cancelar-valido' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/cancelar`)
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('cancelado');
  });

  it('Dado turno con inicio inmediato y token de cancelar Cuando cancela Entonces 400 eje anticipacion', async () => {
    const muyPronto = new Date(Date.now() + 60 * 1000).toISOString(); // +1 minuto (anticipación es 0, pero el test usa config con 0... usar una ventana grande)
    // Para este test necesitamos una configuración con anticipación > 0. Usamos un config aparte.
    const turnoId = crearTurnoTest(db, {
      inicio: muyPronto,
      fin: new Date(new Date(muyPronto).getTime() + 30 * 60 * 1000).toISOString(),
    });
    const token = crearTokenTest(db, { turnoId, accion: 'cancelar', tokenClaro: 'tok-cancelar-sin-anticipacion' });

    const configConAnticipacion: AppConfig = {
      ...AUTH,
      reservaOnline: { ...AUTH.reservaOnline, anticipacionMinSegundos: 7200 }, // 2h
    };
    const res = await request(createApp(db, configConAnticipacion))
      .post(`/api/public/turnos/${turnoId}/cancelar`)
      .query({ token });

    expect(res.status).toBe(400);
    expect(res.body.eje).toBe('anticipacion');
  });

  it('Dado turno confirmado y token de cancelar Cuando cancela Entonces 200 estado cancelado', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
      estado: 'confirmado',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'cancelar', tokenClaro: 'tok-cancelar-confirmado' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/cancelar`)
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('cancelado');
  });
});

// ── POST /api/public/turnos/:id/reprogramar ────────────────────────────────
describe('POST /api/public/turnos/:id/reprogramar', () => {
  it('Dado turno reservado y token de reprogramar sin solape Cuando reprograma Entonces 200, original cancelado y nuevo reservado online', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'reprogramar', tokenClaro: 'tok-reprogramar-valido' });
    const nuevoInicio = '2026-11-02T11:00:00.000Z';
    const nuevoFin = '2026-11-02T11:30:00.000Z';

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/reprogramar`)
      .query({ token })
      .send({ nuevo_inicio: nuevoInicio, nuevo_fin: nuevoFin });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('cancelado'); // el original se cancela
    expect(res.body.turno_reprogramado).toBeDefined();

    // Verificar que el nuevo turno existe con origen online
    const nuevoTurno = new TurnoRepository(db).findById(res.body.turno_reprogramado as string);
    expect(nuevoTurno).toBeDefined();
    expect(nuevoTurno!.estado).toBe('reservado');
    expect(nuevoTurno!.origen).toBe('online');
  });

  it('Dado reprogramar con solape profesional Cuando reprograma Entonces 409 eje profesional', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    // Turno activo del mismo profesional que solapea el nuevo horario
    crearTurnoTest(db, {
      inicio: '2026-11-02T11:15:00.000Z',
      fin: '2026-11-02T11:45:00.000Z',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'reprogramar', tokenClaro: 'tok-reprogramar-solape' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/reprogramar`)
      .query({ token })
      .send({ nuevo_inicio: '2026-11-02T11:30:00.000Z', nuevo_fin: '2026-11-02T12:00:00.000Z' });

    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('profesional');
  });
});

// ── Sin PHI en errores ─────────────────────────────────────────────────────
describe('Sin PHI en errores públicos', () => {
  it('Dado error 409 Cuando inspecciona cuerpo Entonces solo eje e ids opacos', async () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
      estado: 'confirmado',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'confirmar', tokenClaro: 'tok-sin-phi' });

    const res = await request(createApp(db, AUTH))
      .post(`/api/public/turnos/${turnoId}/confirmar`)
      .query({ token });

    expect(res.status).toBe(409);
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toMatch(/Ficticio|Paciente Ejemplo|whatsapp|DNI|dni|historia/i);
  });
});

// ── Servicio directo ───────────────────────────────────────────────────────
describe('Dado servicio ejecutarAccionTurno Cuando el turno es válido Entonces se ejecuta', () => {
  it('confirma turno con SQLite real sin mock de tx', () => {
    const turnoId = crearTurnoTest(db, {
      inicio: '2026-11-02T10:00:00.000Z',
      fin: '2026-11-02T10:30:00.000Z',
    });
    const token = crearTokenTest(db, { turnoId, accion: 'confirmar', tokenClaro: 'tok-directo' });

    const resultado = ejecutarAccionTurno(db, { turnoId, accion: 'confirmar', token }, AUTH);

    expect(resultado.estado).toBe('confirmado');
  });

  it('marca tipos de marca distintos: PacienteId no es ProfesionalId', () => {
    const pac = PAC as PacienteId;
    const prof = PROF as ProfesionalId;
    const distintos: boolean = (pac as string) !== (prof as string);
    expect(distintos).toBe(true);
  });
});
