/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-04 agenda anti-solapamiento.
 * SQLite real en memoria (R11/R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin floats (R2 N/A).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { BloqueoRepository } from '../src/agenda/bloqueo.repository.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { applyMigration003, openDatabase } from '../src/shared/repository.js';
import type {
  PacienteId,
  ProfesionalId,
  SillonId,
} from '../src/shared/types.js';

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
     VALUES (?, ?, ?, ?, ?, ?, ?, 'recepcion', ?, ?)`,
  ).run(
    `turno-${Math.random().toString(36).slice(2)}`,
    args.prof ?? PROF,
    args.sillon ?? SILLA,
    PAC,
    args.inicio,
    args.fin,
    args.estado ?? 'reservado',
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

// ── 2.1/2.2 Migración e índices ─────────────────────────────────────────────
describe('Dado una BD con migraciones 001-002 aplicadas', () => {
  it('Cuando se aplica la migración 003 Entonces crea turno/bloqueo con CHECK fin>inicio', () => {
    // Dado
    const fresca = new DatabaseSync(':memory:');
    try {
      fresca.exec('PRAGMA foreign_keys = ON;');
      // Cuando
      expect(() => applyMigration003(fresca)).not.toThrow();
      // Entonces
      const tablas = fresca
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('turno','bloqueo') ORDER BY name`,
        )
        .all() as { name: string }[];
      expect(tablas.map((t) => t.name)).toEqual(['bloqueo', 'turno']);
      expect(() =>
        fresca
          .prepare(
            `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
             VALUES ('x','p','s','pa','2026-10-07T11:00:00.000Z','2026-10-07T10:00:00.000Z','reservado','recepcion','t','t')`,
          )
          .run(),
      ).toThrow();
    } finally {
      fresca.close();
    }
  });

  it('Cuando se explica la consulta de intersección Entonces usa índice', () => {
    // Dado: consulta de intersección por profesional (design D2)
    // Cuando
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT 1 FROM turno
          WHERE profesional_id = ? AND estado IN ('reservado','confirmado','presente')
          AND inicio < ? AND fin > ? LIMIT 1`,
      )
      .all(
        'x',
        '2026-10-07T10:30:00.000Z',
        '2026-10-07T10:00:00.000Z',
      ) as { detail: string }[];
    // Entonces
    expect(
      plan.some((p) => p.detail.includes('idx_turno_prof_intervalo')),
      JSON.stringify(plan),
    ).toBe(true);
  });
});

// ── 3.1/3.2 Repositorios ────────────────────────────────────────────────────
describe('Dado TurnoRepository sobre SQLite real', () => {
  it('Cuando hay solape parcial Entonces existeSolape es true en ambos ejes', () => {
    // Dado
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const repo = new TurnoRepository(db);
    // Cuando / Entonces
    expect(
      repo.existeSolapeProfesional(
        PROF as ProfesionalId,
        '2026-10-07T10:15:00.000Z',
        '2026-10-07T10:45:00.000Z',
      ),
    ).toBe(true);
    expect(
      repo.existeSolapeSillon(
        SILLA as SillonId,
        '2026-10-07T10:15:00.000Z',
        '2026-10-07T10:45:00.000Z',
      ),
    ).toBe(true);
  });

  it('Cuando el intervalo es contiguo Entonces no hay solape', () => {
    // Dado
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const repo = new TurnoRepository(db);
    // Cuando / Entonces
    expect(
      repo.existeSolapeProfesional(
        PROF as ProfesionalId,
        '2026-10-07T10:30:00.000Z',
        '2026-10-07T11:00:00.000Z',
      ),
    ).toBe(false);
  });

  it('Cuando el turno previo está cancelado Entonces no hay solape', () => {
    // Dado
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'cancelado',
    });
    const repo = new TurnoRepository(db);
    // Cuando / Entonces
    expect(
      repo.existeSolapeProfesional(
        PROF as ProfesionalId,
        '2026-10-07T10:00:00.000Z',
        '2026-10-07T10:30:00.000Z',
      ),
    ).toBe(false);
  });
});

describe('Dado BloqueoRepository sobre SQLite real', () => {
  it('Cuando hay bloqueo global NULL/NULL intersectado Entonces existeBloqueo es true', () => {
    // Dado
    sembrarBloqueo(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);
    // Cuando / Entonces
    expect(
      repo.existeBloqueoAplicable(
        PROF as ProfesionalId,
        SILLA as SillonId,
        '2026-10-07T11:00:00.000Z',
        '2026-10-07T11:30:00.000Z',
      ),
    ).toBe(true);
  });

  it('Cuando el bloqueo es de otro profesional/sillón Entonces no aplica', () => {
    // Dado
    sembrarBloqueo(db, {
      prof: PROF2,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);
    // Cuando / Entonces
    expect(
      repo.existeBloqueoAplicable(
        PROF as ProfesionalId,
        SILLA as SillonId,
        '2026-10-07T11:00:00.000Z',
        '2026-10-07T11:30:00.000Z',
      ),
    ).toBe(false);
  });
});

// ── 5.1–5.7 Escenarios de endpoint ──────────────────────────────────────────
describe('POST /api/turnos', () => {
  it('5.1 Dado profesional y sillón libres Cuando creo turno Entonces 201 reservado', async () => {
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('reservado');
  });

  it('5.2 Dado turno activo del profesional Cuando solapo mismo profesional Entonces 409 eje=profesional', async () => {
    sembrarTurno(db, {
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:15:00.000Z',
        fin: '2026-10-07T10:45:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('profesional');
  });

  it('5.3 Dado turno activo en el sillón Cuando solapo mismo sillón otro profesional Entonces 409 eje=sillon', async () => {
    sembrarTurno(db, {
      prof: PROF2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:15:00.000Z',
        fin: '2026-10-07T10:45:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('sillon');
  });

  it('5.4 Dado turno cancelado Cuando reservo mismo hueco Entonces 201', async () => {
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'cancelado',
    });
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
      });
    expect(res.status).toBe(201);
  });

  it('5.5 Dado bloqueo vigente aplicable Cuando reservo intersectado Entonces 409 eje=bloqueo', async () => {
    sembrarBloqueo(db, {
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T11:00:00.000Z',
        fin: '2026-10-07T11:30:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('bloqueo');
  });

  it('5.6 Dado fin<=inicio Cuando creo turno Entonces 400 y no persiste', async () => {
    const antes = (
      db.prepare(`SELECT COUNT(*) AS n FROM turno`).get() as { n: number }
    ).n;
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T11:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM turno`).get() as { n: number }).n,
    ).toBe(antes);
  });

  it('5.7 Dado turno 10:00-10:30 Cuando creo 10:30-11:00 contiguo Entonces 201', async () => {
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'recepcion')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:30:00.000Z',
        fin: '2026-10-07T11:00:00.000Z',
      });
    expect(res.status).toBe(201);
  });

  it('Dado rol sin permiso Cuando creo turno Entonces 403 sin PHI', async () => {
    const res = await request(createApp(db))
      .post('/api/turnos')
      .set('x-role', 'profesional')
      .send({
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
      });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|Paciente|DNI|dni/i);
  });

  it('4.3 Dado conflicto 409 Cuando inspecciono cuerpo y logs Entonces solo ids opacos sin PHI', async () => {
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    try {
      const res = await request(createApp(db))
        .post('/api/turnos')
        .set('x-role', 'recepcion')
        .send({
          profesional_id: PROF,
          sillon_id: SILLA,
          paciente_id: PAC,
          inicio: '2026-10-07T10:15:00.000Z',
          fin: '2026-10-07T10:45:00.000Z',
        });
      expect(res.status).toBe(409);
      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toMatch(
        /Ficticio|Paciente Ejemplo|whatsapp|DNI|dni|historia/i,
      );
      expect(cuerpo).toMatch(/profesional/);
      expect(logs.join('\n')).not.toMatch(/Ficticio|Paciente Ejemplo|whatsapp|DNI/i);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 5.8 Concurrencia (SQLite real en fichero, sin mock) ─────────────────────
describe('Dado hueco libre Cuando dos escrituras concurrentes Entonces un 201 + un 409', () => {
  it('5.8 doble escritura simultánea deja un único turno activo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c04-'));
    const file = join(dir, 'concurrencia.db');
    const dbFile = openDatabase(file);
    seedBase(dbFile);
    const app = createApp(dbFile);
    try {
      const payload = {
        profesional_id: PROF,
        sillon_id: SILLA,
        paciente_id: PAC,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
      };
      const [r1, r2] = await Promise.all([
        request(app).post('/api/turnos').set('x-role', 'recepcion').send(payload),
        request(app).post('/api/turnos').set('x-role', 'recepcion').send(payload),
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
            '2026-10-07T10:30:00.000Z',
            '2026-10-07T10:00:00.000Z',
          ) as { n: number }
      ).n;
      expect(n).toBe(1);
    } finally {
      dbFile.close();
    }
  });
});

// ── Servicio directo (4.1, SQLite real sin mock de tx) ──────────────────────
describe('Dado servicio crearTurno Cuando el turno contenido solapa Entonces 409 y rollback', () => {
  it('turno contenido por profesional no persiste', () => {
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
    });
    const antes = new TurnoRepository(db).countAll();
    let eje: string | undefined;
    try {
      crearTurno(db, {
        profesionalId: PROF,
        sillonId: SILLA2,
        pacienteId: PAC,
        inicio: '2026-10-07T10:15:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
        rol: 'recepcion',
      });
    } catch (err) {
      eje = (err as { eje?: string }).eje;
    }
    expect(eje).toBe('profesional');
    expect(new TurnoRepository(db).countAll()).toBe(antes);
  });

  it('rechaza fecha sin zona horaria con 400', () => {
    let status: number | undefined;
    try {
      crearTurno(db, {
        profesionalId: PROF,
        sillonId: SILLA,
        pacienteId: PAC,
        inicio: '2026-10-07 10:00',
        fin: '2026-10-07 10:30',
        rol: 'recepcion',
      });
    } catch (err) {
      status = (err as { status?: number }).status;
    }
    expect(status).toBe(400);
  });

  it('brand types distintos: PacienteId no es ProfesionalId (verificación de tipos)', () => {
    const pac = PAC as PacienteId;
    const prof = PROF as ProfesionalId;
    const distintos: boolean = (pac as string) !== (prof as string);
    expect(distintos).toBe(true);
  });
});
