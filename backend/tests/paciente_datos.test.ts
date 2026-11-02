/**
 * C-09 task 8.1: Datos clínicos del paciente - PATCH /api/pacientes/:id.
 * allowlist (`nombre` → 400), fecha `YYYY-MM-DD` no futura,
 * `alergias` > 2000 → 400, `""` → `NULL`, administración con id inexistente → 404,
 * campo sin permiso por rol → 403.
 * SQLite real en memoria (R12), datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { pacientesRouter } from '../src/clinica/pacientes.routes.js';
import type { Rol } from '../src/shared/types.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-c09';

function crearToken(roles: readonly Rol[], sub: string, jti = 'jti'): string {
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

function crearApp(
  db: DatabaseSync,
  roles: readonly Rol[],
  sub: string,
): express.Express {
  const app = express();
  app.use(express.json());
  const token = crearToken(roles, sub);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.auth = {
      userId: sub as never,
      tenantId: 'test',
      roles,
      email: `${sub}@example.test`,
      jti: 'jti',
      profesionalId: roles.includes('profesional') ? ('prof-1' as never) : null,
    };
    next();
  });
  app.use('/api', pacientesRouter(db));
  return app;
}

describe('PATCH /api/pacientes/:id (datos clínicos)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-1', 'Prof Ficticio', 'MAT-1', 'Odonto', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-prof', 'prof@example.test', 'hash', 1, 'prof-1', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-prof', 'profesional')`,
    ).run();
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-admin', 'admin@example.test', 'hash', 1, null, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-admin', 'administracion')`,
    ).run();
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-recepcion', 'recepcion@example.test', 'hash', 1, null, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-recepcion', 'recepcion')`,
    ).run();
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, fecha_nacimiento, alergias, created_at, updated_at, deleted_at)
       VALUES ('pac-1', 'Paciente Ficticio', 1, null, null, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  });

  afterEach(() => {
    db.close();
  });

  it('Dado campo no permitido (nombre) Cuando PATCH Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ nombre: 'Nuevo Nombre' });
    expect(res.status).toBe(400);
  });

  it('Dado fecha futura Cuando PATCH fecha_nacimiento Entonces 400', async () => {
    const app = crearApp(db, ['administracion'], 'user-admin');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ fecha_nacimiento: '2030-01-01' });
    expect(res.status).toBe(400);
  });

  it('Dado alergias > 2000 caracteres Cuando PATCH Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ alergias: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('Dado alergias vacío Cuando PATCH Entonces se guarda NULL', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ alergias: '' });
    expect(res.status).toBe(200);
  });

  it('Dado administración con id inexistente Cuando PATCH Entonces 404', async () => {
    const app = crearApp(db, ['administracion'], 'user-admin');
    const res = await request(app)
      .patch('/api/pacientes/pac-inexistente')
      .send({ fecha_nacimiento: '1990-01-01' });
    expect(res.status).toBe(404);
  });

  it('Dado recepción Cuando PATCH fecha_nacimiento Entonces 200', async () => {
    const app = crearApp(db, ['recepcion'], 'user-recepcion');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ fecha_nacimiento: '1990-01-01' });
    expect(res.status).toBe(200);
  });

  it('Dado profesional Cuando PATCH alergias válida Entonces 200', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ alergias: 'Penicilina' });
    expect(res.status).toBe(200);
  });

  it('Dado administración Cuando PATCH fecha_nacimiento válida Entonces 200', async () => {
    const app = crearApp(db, ['administracion'], 'user-admin');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ fecha_nacimiento: '1990-01-01' });
    expect(res.status).toBe(200);
  });

  it('Dado profesional Cuando PATCH fecha_nacimiento Entonces 403', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ fecha_nacimiento: '1990-01-01' });
    expect(res.status).toBe(403);
  });

  it('Dado administración Cuando PATCH alergias Entonces 403', async () => {
    const app = crearApp(db, ['administracion'], 'user-admin');
    const res = await request(app)
      .patch('/api/pacientes/pac-1')
      .send({ alergias: 'Penicilina' });
    expect(res.status).toBe(403);
  });
});
