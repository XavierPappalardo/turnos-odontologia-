/**
 * Task 5.1/5.2: Tests de integración HTTP para presupuestos (C-10).
 * Verifica códigos de respuesta de cada ruta y autorización clínica:
 * - profesional con acceso lee/escribe ítems clínicos (200/201)
 * - recepcion recibe 403 en ítems vinculados al odontograma
 * SQLite REAL en memoria (R12). Datos ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { presupuestosRouter } from '../src/clinica/presupuestos.routes.js';
import type { Rol } from '../src/shared/types.js';

let db: DatabaseSync;

const NOW = '2026-11-01T10:00:00.000Z';

function seedBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at) VALUES ('user-1', 'u@ficticio.test', 'hash', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-1', 'Prof Ficticio', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `UPDATE usuario SET profesional_id = 'prof-1' WHERE id = 'user-1'`,
  ).run();
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', NULL, 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES ('plan-1', 'OS Ficticia', 'Plan Ficticio', 60, 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO odontograma_evento (id, paciente_id, turno_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at) VALUES ('odo-1', 'pac-1', 'turno-1', 16, 'O', 'caries', ?, 'user-1', 'prof-1', ?)`,
  ).run(NOW, NOW);
}

/**
 * Crea una mini-app Express con auth inyectado via res.locals (sin JWT real).
 * Sigue el mismo patrón que clinica_integracion.test.ts (C-09).
 */
function crearApp(
  db: DatabaseSync,
  roles: readonly Rol[],
  userId: string,
  profesionalId: string | null,
): express.Express {
  const app = express();
  app.use(express.json());
  // Inyectar auth directamente (sin pasar por requireAuth)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.auth = {
      userId: userId as never,
      tenantId: 'test',
      roles,
      email: `${userId}@example.test`,
      jti: 'jti',
      ...(profesionalId !== null ? { profesionalId } : {}),
    };
    next();
  });
  app.use('/api', presupuestosRouter(db));
  return app;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
});

afterEach(() => {
  db.close();
});

// ── 5.1 CRUD básico de presupuestos ──
describe('5.1 GET /api/pacientes/:pacienteId/presupuestos', () => {
  it('Dado paciente sin presupuestos Cuando GET Entonces 200 y lista vacía', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(app).get('/api/pacientes/pac-1/presupuestos');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('5.1 POST /api/pacientes/:pacienteId/presupuestos', () => {
  it('Dado paciente válido Cuando POST sin turno_id Entonces 201 y estado borrador', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('borrador');
    expect(res.body.turno_id).toBeNull();
  });

  it('Dado turno del paciente Cuando POST con turno_id Entonces 201 y conserva turno_id', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({ turno_id: 'turno-1' });
    expect(res.status).toBe(201);
    expect(res.body.turno_id).toBe('turno-1');
  });

  it('Dado turno de otro paciente Cuando POST Entonces 400', async () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at) VALUES ('pac-otro', 'Otro', 1, ?, ?)`,
    ).run(NOW, NOW);
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('turno-otro', 'prof-1', 'sillon-1', 'pac-otro', '2026-11-01T11:00:00.000Z', '2026-11-01T11:30:00.000Z', 'reservado', 'recepcion', ?, ?)`,
    ).run(NOW, NOW);
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({ turno_id: 'turno-otro' });
    expect(res.status).toBe(400);
  });
});

describe('5.1 GET /api/presupuestos/:id', () => {
  it('Dado presupuesto existente Cuando GET Entonces 200', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app).get(`/api/presupuestos/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('Dado presupuesto inexistente Cuando GET Entonces 404', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(app).get('/api/presupuestos/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('5.1 PATCH /api/presupuestos/:id', () => {
  it('Dado presupuesto borrador Cuando PATCH total Entonces 200 con nuevo total', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({ total_centavos: 10000 });
    const res = await request(app)
      .patch(`/api/presupuestos/${created.body.id}`)
      .send({ total_centavos: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.total_centavos).toBe(20000);
  });

  it('Dado presupuesto enviado Cuando PATCH Entonces 400', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    await request(app)
      .post(`/api/presupuestos/${created.body.id}/transicion`)
      .send({ estado: 'enviado' });
    const res = await request(app)
      .patch(`/api/presupuestos/${created.body.id}`)
      .send({ total_centavos: 99999 });
    expect(res.status).toBe(400);
  });
});

describe('5.1 DELETE /api/presupuestos/:id', () => {
  it('Dado presupuesto existente Cuando DELETE Entonces 204', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app).delete(`/api/presupuestos/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it('Dado presupuesto eliminado Cuando GET Entonces 404', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    await request(app).delete(`/api/presupuestos/${created.body.id}`);
    const res = await request(app).get(`/api/presupuestos/${created.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe('5.1 POST /api/presupuestos/:id/transicion', () => {
  it('Dado borrador Cuando transición a enviado Entonces 200 y estado enviado', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/transicion`)
      .send({ estado: 'enviado' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('enviado');
  });

  it('Dado borrador Cuando transición directa a aceptado Entonces 400', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/transicion`)
      .send({ estado: 'aceptado' });
    expect(res.status).toBe(400);
  });

  it('Dado body vacío Cuando transición Entonces 400 estado_requerido', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/transicion`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('5.1 POST /api/presupuestos/:id/items — sin vínculo clínico', () => {
  it('Dado ítem sin pieza_fdi Cuando POST Entonces 201 — cualquier rol', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({ descripcion: 'Consulta ficticia', monto_centavos: 30000, pieza_fdi: null, superficie: null });
    expect(res.status).toBe(201);
    expect(res.body.monto_centavos).toBe(30000);
  });

  it('Dado ítem con monto negativo Cuando POST Entonces 400', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({ descripcion: 'Item ficticio', monto_centavos: -100, pieza_fdi: null, superficie: null });
    expect(res.status).toBe(400);
  });
});

// ── 5.2 Autorización clínica (clinica/acceso-hc) ──
describe('5.2 Autorización clínica en ítems vinculados al odontograma', () => {
  it('Dado profesional con profesionalId Cuando POST ítem con pieza_fdi Entonces 201', async () => {
    const app = crearApp(db, ['profesional'], 'user-1', 'prof-1');
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({
        descripcion: 'Obturación ficticia',
        monto_centavos: 25000,
        pieza_fdi: 16,
        superficie: 'O',
      });
    expect(res.status).toBe(201);
    expect(res.body.pieza_fdi).toBe(16);
  });

  it('Dado recepcion (sin profesionalId) Cuando POST ítem con pieza_fdi Entonces 403', async () => {
    // Primero crear presupuesto con profesional
    const appProf = crearApp(db, ['profesional'], 'user-1', 'prof-1');
    const created = await request(appProf)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});

    // Intentar agregar ítem clínico con recepcion
    const appRec = crearApp(db, ['recepcion'], 'user-1', null);
    const res = await request(appRec)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({
        descripcion: 'Obturación ficticia',
        monto_centavos: 25000,
        pieza_fdi: 16,
        superficie: 'O',
      });
    expect(res.status).toBe(403);
  });

  it('Dado administracion (sin profesionalId) Cuando POST ítem con pieza_fdi Entonces 403', async () => {
    const appProf = crearApp(db, ['profesional'], 'user-1', 'prof-1');
    const created = await request(appProf)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});

    const appAdmin = crearApp(db, ['administracion'], 'user-1', null);
    const res = await request(appAdmin)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({
        descripcion: 'Item ficticio',
        monto_centavos: 10000,
        pieza_fdi: 16,
        superficie: 'O',
      });
    expect(res.status).toBe(403);
  });

  it('Dado recepcion Cuando POST ítem SIN pieza_fdi Entonces 201 — no requiere acceso clínico', async () => {
    const app = crearApp(db, ['recepcion'], 'user-1', null);
    const created = await request(app)
      .post('/api/pacientes/pac-1/presupuestos')
      .send({});
    const res = await request(app)
      .post(`/api/presupuestos/${created.body.id}/items`)
      .send({
        descripcion: 'Consulta ficticia',
        monto_centavos: 15000,
        pieza_fdi: null,
        superficie: null,
      });
    expect(res.status).toBe(201);
  });
});
