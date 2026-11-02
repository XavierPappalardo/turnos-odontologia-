/**
 * C-09 task 5.1: Acceso a historia clínica - resolverProfesional.
 * `profesional_id` null → 403. Desvinculación con token vigente → 403 inmediato.
 * SQLite real en memoria (R12), datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { requireAuth } from '../src/auth/middleware.js';
import type { Rol } from '../src/shared/types.js';
import { resolverProfesional } from '../src/clinica/resolverProfesional.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-c09';

function crearToken(roles: readonly Rol[], sub: string, jti = 'jti-test'): string {
  return signToken(
    {
      sub,
      tenantId: 'test',
      roles,
      email: 'test@example.test',
      type: 'access',
      ttlSeconds: 900,
      jti,
    },
    JWT_SECRET,
  );
}

function crearAppConGuard(db: DatabaseSync): express.Express {
  const app = express();
  app.use('/clinica', requireAuth(JWT_SECRET, db));
  app.use('/clinica', resolverProfesional(JWT_SECRET, db));
  app.get('/clinica/test', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('resolverProfesional (profesional_id resuelto por request)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    // Insertar profesional requerido por FK de usuario.profesional_id
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-seed-0001', 'Prof Ficticio', 'MAT-1', 'Odonto Ficticia', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    // Usuario SIN profesional_id (rol professional pero desvinculado)
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-sin-vinculo', 'sinvinculo@example.test', 'hash', 1, null, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-sin-vinculo', 'profesional')`,
    ).run();
    // Usuario CON profesional_id vinculado
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-con-vinculo', 'vinculo@example.test', 'hash', 1, 'prof-seed-0001', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-con-vinculo', 'profesional')`,
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it('Dado usuario sin profesional_id Cuando accede a ruta clínica Entonces 403 sin_vinculo', async () => {
    const app = crearAppConGuard(db);
    const token = crearToken(['profesional' as const], 'user-sin-vinculo', 'jti-sin-vinculo');
    const res = await request(app)
      .get('/clinica/test')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('sin_vinculo');
  });

  it('Dado token vigente pero profesional_id removido Cuando accede Entonces 403 inmediato', async () => {
    const app = crearAppConGuard(db);
    const token = crearToken(['profesional' as const], 'user-con-vinculo', 'jti-vigente');
    // Desvincular: quitar profesional_id del usuario vinculado
    db.prepare(
      `UPDATE usuario SET profesional_id = NULL WHERE id = 'user-con-vinculo'`,
    ).run();
    const res = await request(app)
      .get('/clinica/test')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('sin_vinculo');
  });

  it('Dado usuario con profesional_id vinculado Cuando accede Entonces pasa al siguiente middleware', async () => {
    const app = crearAppConGuard(db);
    const token = crearToken(['profesional' as const], 'user-con-vinculo', 'jti-vinculado');
    const res = await request(app)
      .get('/clinica/test')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
