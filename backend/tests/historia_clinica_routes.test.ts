/**
 * C-09 task 6.5: Rutas de historia clínica con supertest.
 * 201, 200, 400, 403, 404, 409 + montaje en shared/app.ts.
 * SQLite real en memoria (R12), datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { resolverProfesional } from '../src/clinica/resolverProfesional.js';
import { historiaClinicaRouter } from '../src/clinica/historiaClinica.routes.js';
import type { Rol } from '../src/shared/types.js';

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
  app.use('/api', historiaClinicaRouter(db));
  return app;
}

describe('Rutas de historia clínica', () => {
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
       VALUES ('user-recepcion', 'recepcion@example.test', 'hash', 1, null, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-recepcion', 'recepcion')`,
    ).run();
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-1', 'Paciente Ficticio', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
       VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  });

  afterEach(() => {
    db.close();
  });

  it('Dado profesional titular Cuando registra evento HC Entonces 201 con evento', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle ficticio de consulta',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
        turno_id: 'turno-1',
      });
    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('consulta');
    expect(res.body.es_vigente).toBe(true);
    expect(res.body.turno_id).toBe('turno-1');
    expect(res.body.ocurrido_en).toBe('2026-11-01T13:00:00.000Z');
  });

  it('Dado tipo inválido Cuando registra evento Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'receta',
        detalle: 'detalle ficticio',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
      });
    expect(res.status).toBe(400);
  });

  it('Dado detalle vacío Cuando registra evento Entonces 400', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: '',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
      });
    expect(res.status).toBe(400);
  });

  it('Dado turno_id de otro paciente Cuando registra Entonces 404', async () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
       VALUES ('turno-2', 'prof-1', 'sillon-1', 'pac-2', null, '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');

    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle ficticio',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
        turno_id: 'turno-2',
      });
    expect(res.status).toBe(404);
  });

  it('Dado recepción Cuando intenta registrar evento Entonces 403', async () => {
    const app = crearApp(db, ['recepcion'], 'user-recepcion', null);
    const res = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle ficticio',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
      });
    expect(res.status).toBe(403);
  });

  it('Dado paciente con eventos Cuando lista HC Entonces 200 con eventos', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle ficticio',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
        turno_id: 'turno-1',
      });

    const res = await request(app)
      .get('/api/pacientes/pac-1/historia-clinica');
    expect(res.status).toBe(200);
    expect(res.body.paciente_id).toBe('pac-1');
    expect(res.body.eventos.length).toBe(1);
    expect(res.body.eventos[0].es_vigente).toBe(true);
  });

  it('Dado paciente sin eventos Cuando lista HC Entonces 200 con lista vacía', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const res = await request(app)
      .get('/api/pacientes/pac-1/historia-clinica');
    expect(res.status).toBe(200);
    expect(res.body.eventos).toEqual([]);
  });

  it('Dado filtro turno_id Cuando lista HC Entonces devuelve solo eventos de ese turno', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'con turno',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
        turno_id: 'turno-1',
      });
    await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'nota',
        detalle: 'sin turno',
        ocurrido_en: '2026-11-01T11:00:00-03:00',
      });

    const res = await request(app)
      .get('/api/pacientes/pac-1/historia-clinica?turno_id=turno-1');
    expect(res.status).toBe(200);
    expect(res.body.eventos.length).toBe(1);
    expect(res.body.eventos[0].turno_id).toBe('turno-1');
  });

  it('Dado evento existente Cuando enmienda Entonces 201 con enmienda', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const creado = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle original',
        ocurrido_en: '2026-10-01T10:00:00-03:00',
      });
    const eventoId = creado.body.id;

    const res = await request(app)
      .post(`/api/pacientes/pac-1/historia-clinica/eventos/${eventoId}/enmiendas`)
      .send({
        tipo: 'consulta',
        detalle: 'detalle corregido',
        motivo_enmienda: 'corrección de carga',
      });
    expect(res.status).toBe(201);
    expect(res.body.enmienda_de).toBe(eventoId);
    expect(res.body.es_vigente).toBe(true);
  });

  it('Dado doble enmienda Cuando intenta enmendar mismo evento Entonces 409', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const creado = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle original',
        ocurrido_en: '2026-10-01T10:00:00-03:00',
      });
    const eventoId = creado.body.id;

    await request(app)
      .post(`/api/pacientes/pac-1/historia-clinica/eventos/${eventoId}/enmiendas`)
      .send({
        tipo: 'consulta',
        detalle: 'primera enmienda',
        motivo_enmienda: 'motivo 1',
      });

    const res = await request(app)
      .post(`/api/pacientes/pac-1/historia-clinica/eventos/${eventoId}/enmiendas`)
      .send({
        tipo: 'consulta',
        detalle: 'segunda enmienda',
        motivo_enmienda: 'motivo 2',
      });
    expect(res.status).toBe(409);
  });

  it('Dado evento de otro paciente Cuando intenta enmendar Entonces 404', async () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');

    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const creado = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .send({
        tipo: 'consulta',
        detalle: 'detalle propio',
        ocurrido_en: '2026-10-01T10:00:00-03:00',
      });
    const eventoId = creado.body.id;

    const res = await request(app)
      .post(`/api/pacientes/pac-2/historia-clinica/eventos/${eventoId}/enmiendas`)
      .send({
        tipo: 'consulta',
        detalle: 'intento ajeno',
        motivo_enmienda: 'motivo',
      });
    expect(res.status).toBe(404);
  });
});
