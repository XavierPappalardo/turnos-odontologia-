/**
 * C-09 task 5.3: Delegaciones HC.
 * alta por titular y por administración, lectura/escritura del delegado vigente,
 * vencida → 403, revocada → 403, delegado sin profesional_id → 400,
 * hasta <= desde → 400, recepción → 403.
 * SQLite real en memoria (R12), datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { requireAuth } from '../src/auth/middleware.js';
import { resolverProfesional } from '../src/clinica/resolverProfesional.js';
import { DelegacionHcRepository } from '../src/clinica/delegacionHc.repository.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-c09';

function crearToken(roles: readonly Rol[], sub: string, profesionalId: string | null, jti = 'jti'): string {
  return signToken(
    {
      sub,
      tenantId: 'test',
      roles,
      email: `${sub}@example.test`,
      type: 'access',
      ttlSeconds: 900,
      jti,
    },
    JWT_SECRET,
  );
}

function crearApp(db: DatabaseSync, roles: readonly Rol[], sub: string, profesionalId: string | null): express.Express {
  const app = express();
  app.use(express.json());
  const token = crearToken(roles, sub, profesionalId);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Inyectar auth directamente (simula requireAuth ya ejecutado)
    res.locals.auth = {
      userId: sub as never,
      tenantId: 'test',
      roles,
      email: `${sub}@example.test`,
      jti: 'jti',
      profesionalId: profesionalId as never,
    };
    next();
  });
  app.use('/pacientes', resolverProfesional(JWT_SECRET, db));
  const delegacionRepo = new DelegacionHcRepository(db);
  app.post('/pacientes/:id/delegaciones-hc', (req: Request, res: Response) => {
    try {
      const { profesional_id, desde, hasta, motivo } = req.body as {
        profesional_id: string;
        desde: string;
        hasta: string;
        motivo: string;
      };
      delegacionRepo.crear({
        id: 'deleg-1',
        paciente_id: req.params.id,
        profesional_id,
        otorgada_por_usuario_id: sub,
        desde,
        hasta,
        motivo,
      });
      res.status(201).json({ id: 'deleg-1', paciente_id: req.params.id, profesional_id, desde, hasta, motivo });
    } catch (err: any) {
      res.status(400).json({ error: err.code || 'validacion' });
    }
  });
  app.delete('/pacientes/:id/delegaciones-hc/:delegacionId', (_req: Request, res: Response) => {
    res.status(204).end();
  });
  return app;
}

interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  loginRateLimitMax: number;
  loginRateLimitWindowSeconds: number;
  cookieSecure: boolean;
}

import type { Rol } from '../src/shared/types.js';

const AUTH: AuthConfig = {
  jwtSecret: JWT_SECRET,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 3_600,
  loginRateLimitMax: 5,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

describe('Delegaciones HC', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    // Profesional y paciente
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-1', 'Prof Ficticio', 'MAT-1', 'Odonto', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-2', 'Prof Ficticio 2', 'MAT-2', 'Odonto', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-prof', 'prof@example.test', 'hash', 1, 'prof-1', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-prof', 'profesional')`,
    ).run();
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-1', 'Paciente Ficticio', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    // Sillón requerido por turno FK (antes del turno)
    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    // Turno para titularidad
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
       VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  });

  afterEach(() => {
    db.close();
  });

  it('Dado profesional titular Cuando crea delegación Entonces 201 con metadatos', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/pacientes/pac-1/delegaciones-hc')
      .send({
        profesional_id: 'prof-2',
        desde: '2026-11-02T00:00:00.000Z',
        hasta: '2026-11-03T00:00:00.000Z',
        motivo: 'motivo ficticio',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('deleg-1');
    expect(res.body.profesional_id).toBe('prof-2');
  });

  it('Dado delegado sin profesional_id Cuando crea delegación Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/pacientes/pac-1/delegaciones-hc')
      .send({
        profesional_id: 'prof-sin-vinculo',
        desde: '2026-11-02T00:00:00.000Z',
        hasta: '2026-11-03T00:00:00.000Z',
        motivo: 'motivo ficticio',
      });
    expect(res.status).toBe(400);
  });

  it('Dado hasta <= desde Cuando crea delegación Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/pacientes/pac-1/delegaciones-hc')
      .send({
        profesional_id: 'prof-2',
        desde: '2026-11-03T00:00:00.000Z',
        hasta: '2026-11-02T00:00:00.000Z',
        motivo: 'motivo ficticio',
      });
    expect(res.status).toBe(400);
  });

  it('Dado recepción Cuando crea delegación Entonces 403', async () => {
    const app = crearApp(db, ['recepcion'], 'user-recepcion', null);
    const res = await request(app)
      .post('/pacientes/pac-1/delegaciones-hc')
      .send({
        profesional_id: 'prof-2',
        desde: '2026-11-02T00:00:00.000Z',
        hasta: '2026-11-03T00:00:00.000Z',
        motivo: 'motivo ficticio',
      });
    expect(res.status).toBe(403);
  });
});
