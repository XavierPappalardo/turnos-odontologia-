/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-05 reserva online.
 * SQLite real en memoria (R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin floats (R2 N/A).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import type { AppConfig } from '../src/shared/config.js';
import type { PacienteId, ProfesionalId, SillonId } from '../src/shared/types.js';
import { reservarTurnoOnline } from '../src/agenda/reservaOnline.service.js';

const AUTH: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c05',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
  reservaOnline: {
    anticipacionMinSegundos: 7200, // 2 h [Supuesto RN-06]
    rateMax: 1000, // alto para que no interfiera en tests funcionales
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60,
    },
    recordatorio: {
      t48hHoras: 48,
      t24hHoras: 24,
      canalPredeterminado: 'whatsapp',
    },
  };

// ── Fixtures ficticios (R1/R12) ────────────────────────────────────────────
const PROF = 'prof-0001';
const PROF2 = 'prof-0002';
const SILLA = 'sillon-0001';
const SILLA2 = 'sillon-0002';
const PAC = 'pac-0001';

function seedBase(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(PROF, 'Prof Ficticio Uno', now, now);
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(PROF2, 'Prof Ficticia Dos', now, now);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(SILLA, 'Sillon Ficticio 1', now, now);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(SILLA2, 'Sillon Ficticio 2', now, now);
  db.prepare(
    `INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(PAC, 'Paciente Ficticio Ejemplo', now, now);
}

function sembrarTurno(
  db: DatabaseSync,
  args: {
    prof?: string;
    sillon?: string;
    inicio: string;
    fin: string;
    estado?: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `turno-${Math.random().toString(36).slice(2)}`,
    args.prof ?? PROF,
    args.sillon ?? SILLA,
    PAC,
    args.inicio,
    args.fin,
    args.estado ?? 'reservado',
    'recepcion',
    now,
    now,
  );
}

function sembrarBloqueo(
  db: DatabaseSync,
  args: {
    prof?: string | null;
    sillon?: string | null;
    inicio: string;
    fin: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bloqueo (id, profesional_id, sillon_id, inicio, fin, motivo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'motivo ficticio', ?, ?)`,
  ).run(
    `bloq-${Math.random().toString(36).slice(2)}`,
    args.prof ?? null,
    args.sillon ?? null,
    args.inicio,
    args.fin,
    now,
    now,
  );
}

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
});

afterEach(() => {
  db.close();
});

// ── POST /api/public/turnos ─────────────────────────────────────────────────
describe('POST /api/public/turnos (reserva online, sin autenticación)', () => {
  it('Dado profesional y sillón libres Cuando reserva online Entonces 201 con origen online', async () => {
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T10:00:00.000Z',
        fin: '2026-11-02T10:30:00.000Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('reservado');
    expect(res.body.origen).toBe('online');
    expect(res.body.id).toBeDefined();
  });

  it('Dado turno activo del profesional Cuando reserva solapado Entonces 409 eje=profesional', async () => {
    sembrarTurno(db, { sillon: SILLA2, inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T10:30:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T10:15:00.000Z',
        fin: '2026-11-02T10:45:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('profesional');
  });

  it('Dado turno activo en el sillón Cuando reserva solapado otro profesional Entonces 409 eje=sillon', async () => {
    sembrarTurno(db, { prof: PROF2, inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T10:30:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T10:15:00.000Z',
        fin: '2026-11-02T10:45:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('sillon');
  });

  it('Dado bloqueo vigente aplicable Cuando reserva intersectado Entonces 409 eje=bloqueo', async () => {
    sembrarBloqueo(db, { prof: PROF, inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T12:00:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T11:00:00.000Z',
        fin: '2026-11-02T11:30:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('bloqueo');
  });

  it('Dado fin<=inicio Cuando reserva Entonces 400 y no persiste', async () => {
    const antes = (db.prepare(`SELECT COUNT(*) AS n FROM turno`).get() as { n: number }).n;
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T11:00:00.000Z',
        fin: '2026-11-02T10:30:00.000Z',
      });
    expect(res.status).toBe(400);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM turno`).get() as { n: number }).n).toBe(antes);
  });

  it('Dado inicio dentro de ventana de anticipación (2h) Cuando reserva Entonces 400 eje=anticipacion', async () => {
    const muyPronto = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora desde ahora
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: muyPronto,
        fin: new Date(new Date(muyPronto).getTime() + 30 * 60 * 1000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.eje).toBe('anticipacion');
  });

  it('Dado inicio respetando anticipación Cuando reserva Entonces 201', async () => {
    const futuro = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // 3 horas desde ahora (> 2h)
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: futuro,
        fin: new Date(new Date(futuro).getTime() + 30 * 60 * 1000).toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('reservado');
  });

  it('Dado campo obligatorio faltante Cuando reserva Entonces 400', async () => {
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        // falta paciente_id, inicio, fin
      });
    expect(res.status).toBe(400);
  });

  it('Dado cuerpo sin PHI Cuando hay error 409 Entonces respuesta solo tiene eje e ids opacos', async () => {
    sembrarTurno(db, { inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T10:30:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .post('/api/public/turnos')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-11-02T10:15:00.000Z',
        fin: '2026-11-02T10:45:00.000Z',
      });
    expect(res.status).toBe(409);
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toMatch(/Ficticio|Paciente Ejemplo|whatsapp|DNI|dni|historia/i);
    expect(cuerpo).toMatch(/profesional/);
  });
});

// ── GET /api/public/agenda/disponibilidad ───────────────────────────────────
describe('GET /api/public/agenda/disponibilidad', () => {
  it('Dado fecha sin turnos Cuando consulta disponibilidad Entonces devuelve huecos libres', async () => {
    const res = await request(createApp(db, AUTH))
      .get('/api/public/agenda/disponibilidad')
      .query({ profesional_id: PROF, sillon_id: SILLA, fecha: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.huecos_libres.length).toBeGreaterThan(0);
    expect(res.body.profesional_id).toBe(PROF);
    expect(res.body.sillon_id).toBe(SILLA);
    expect(res.body.fecha).toBe('2026-11-02');
  });

  it('Dado turno activo Cuando consulta disponibilidad Entonces excluye ese hueco', async () => {
    sembrarTurno(db, { inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T10:30:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .get('/api/public/agenda/disponibilidad')
      .query({ profesional_id: PROF, sillon_id: SILLA, fecha: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.huecos_libres).not.toContain('2026-11-02T10:00:00.000Z');
  });

  it('Dado bloqueo vigente Cuando consulta disponibilidad Entonces excluye ese hueco', async () => {
    sembrarBloqueo(db, { prof: PROF, inicio: '2026-11-02T10:00:00.000Z', fin: '2026-11-02T12:00:00.000Z' });
    const res = await request(createApp(db, AUTH))
      .get('/api/public/agenda/disponibilidad')
      .query({ profesional_id: PROF, sillon_id: SILLA, fecha: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.huecos_libres).not.toContain('2026-11-02T10:00:00.000Z');
    expect(res.body.huecos_libres).not.toContain('2026-11-02T10:30:00.000Z');
  });

  it('Dado campos faltantes Cuando consulta disponibilidad Entonces 400', async () => {
    const res = await request(createApp(db, AUTH))
      .get('/api/public/agenda/disponibilidad')
      .query({ profesional_id: PROF }); // falta sillon_id y fecha
    expect(res.status).toBe(400);
  });
});

// ── Rate limit público ──────────────────────────────────────────────────────
describe('Rate limiting público (C-05)', () => {
  it('Dado IP excede rate limit Cuando reserva Entonces 429', async () => {    const dir = mkdtempSync(join(tmpdir(), 'c05-rate-'));
    const file = join(dir, 'rate.db');
    const dbFile = openDatabase(file);
    seedBase(dbFile);
    const rateConfig: AppConfig = { ...AUTH, reservaOnline: { ...AUTH.reservaOnline, rateMax: 2, rateWindowSeconds: 60 } };
    const app = createApp(dbFile, rateConfig);
    try {
      const payload = {
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(), // +10h (respeta anticipación)
        fin: new Date(Date.now() + 10.5 * 60 * 60 * 1000).toISOString(),
      };
      const r1 = await request(app).post('/api/public/turnos').send(payload);
      const r2 = await request(app).post('/api/public/turnos').send(payload);
      const r3 = await request(app).post('/api/public/turnos').send(payload);
      const statuses = [r1.status, r2.status, r3.status];
      expect(statuses).toContain(429);
      expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(2);
    } finally {
      dbFile.close();
    }
  });
});

// ── Servicio directo ────────────────────────────────────────────────────────
describe('Dado servicio reservarTurnoOnline Cuando el turno es válido Entonces se persiste', () => {
  it('reserva online directa con SQLite real sin mock de tx', () => {
    const antes = new TurnoRepository(db).countAll();
    const futuro = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(); // +5h
    const creado = reservarTurnoOnline(db, {
      profesionalId: PROF,
      sillonId: SILLA,
      pacienteId: PAC,
      inicio: futuro,
      fin: new Date(new Date(futuro).getTime() + 30 * 60 * 1000).toISOString(),
    }, AUTH.reservaOnline.anticipacionMinSegundos);
    expect(creado.origen).toBe('online');
    expect(creado.estado).toBe('reservado');
    expect(new TurnoRepository(db).countAll()).toBe(antes + 1);
  });

  it('marca tipos de marca distintintos: PacienteId no es ProfesionalId', () => {
    const pac = PAC as PacienteId;
    const prof = PROF as ProfesionalId;
    const distintos: boolean = (pac as string) !== (prof as string);
    expect(distintos).toBe(true);
  });
});

// ── Concurrencia pública ────────────────────────────────────────────────────
describe('Dado hueco libre Cuando dos escrituras concurrentes públicas Entonces un 201 + un 409', () => {
  it('doble escritura simultánea deja un único turno activo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c05-conc-'));
    const file = join(dir, 'concurrencia.db');
    const dbFile = openDatabase(file);
    seedBase(dbFile);
    const app = createApp(dbFile, AUTH);
    try {
      const futuro = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(); // +5h (respeta anticipación)
      const payload = {
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: futuro,
        fin: new Date(new Date(futuro).getTime() + 30 * 60 * 1000).toISOString(),
      };
      const [r1, r2] = await Promise.all([
        request(app).post('/api/public/turnos').send(payload),
        request(app).post('/api/public/turnos').send(payload),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
      const n = (
        dbFile
          .prepare(
            `SELECT COUNT(*) AS n FROM turno WHERE profesional_id = ? AND sillon_id = ?
             AND estado IN ('reservado','confirmado','presente')
             AND inicio < ? AND fin > ?`,
          )
          .get(
            PROF,
            SILLA,
            new Date(new Date(futuro).getTime() + 30 * 60 * 1000).toISOString(),
            futuro,
          ) as { n: number }
      ).n;
      expect(n).toBe(1);
    } finally {
      dbFile.close();
    }
  });
});
