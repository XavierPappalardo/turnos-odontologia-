/**
 * Tests para la capacidad obras-sociales/planes (C-12).
 * Verificación con SQLite real en memoria (R11/R12) y fixtures ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planesRouter } from '../src/obras-sociales/planes.routes.js';
import { coberturasRouter } from '../src/obras-sociales/coberturas.routes.js';
import { createErrorHandler } from '../src/shared/error-handler.js';
import { createLogger } from '../src/shared/logger.js';
import { openDatabase } from '../src/shared/repository.js';
import { AUTH, bearer } from './helpers/agenda-fixtures.js';

describe('obras-sociales/planes', () => {
  let db: DatabaseSync;
  let app: express.Express;

  beforeEach(() => {
    db = openDatabase(':memory:');

    // Inyectar usuario para el token
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO usuario (id, email, password_hash, activo, created_at, updated_at)
       VALUES ('user-test-c08', 'bloqueos@example.test', 'hash', 1, ?, ?)`,
    ).run(now, now);

    // Sembrar un plan inicial ficticio (R1/R12)
    db.prepare(
      `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
       VALUES ('plan-seed-1', 'Obra Social Ficticia A', 'Plan Ficticio 100', 100, 1, ?, ?)`,
    ).run(now, now);

    app = express();
    app.use(express.json());
    app.use('/api/obras-sociales', planesRouter(db, AUTH));
    app.use('/api/obras-sociales', coberturasRouter(db, AUTH));
    app.use(createErrorHandler(createLogger(() => {})));
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/obras-sociales/planes', () => {
    it('Dado un usuario recepción autenticado Cuando consulta planes Entonces responde 200 con planes vigentes y sin PHI', async () => {
      const res = await request(app)
        .get('/api/obras-sociales/planes')
        .set('authorization', bearer(['recepcion']));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const plan = res.body[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('obra_social');
      expect(plan).toHaveProperty('plan');
      expect(plan).toHaveProperty('cobertura_pct');
      expect(plan).not.toHaveProperty('dni');
      expect(plan).not.toHaveProperty('paciente');
    });

    it('Dado filtros exactos de obra_social y plan Cuando consulta Entonces filtra correctamente', async () => {
      // Seed por defecto tiene OS='OSDE', plan='210' o similar en migrations/seed
      // Creamos dos planes para filtrar exactamente
      await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'Swiss Medical Ficticia',
          plan: 'SMG20 Ficticio',
          cobertura_pct: 70,
        });

      const res = await request(app)
        .get(
          '/api/obras-sociales/planes?obra_social=Swiss%20Medical%20Ficticia&plan=SMG20%20Ficticio',
        )
        .set('authorization', bearer(['recepcion']));

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].obra_social).toBe('Swiss Medical Ficticia');
      expect(res.body[0].plan).toBe('SMG20 Ficticio');
    });

    it('Dado una petición sin token Cuando consulta planes Entonces responde 401', async () => {
      const res = await request(app).get('/api/obras-sociales/planes');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/obras-sociales/planes', () => {
    it('Dado administración con body válido Cuando crea plan Entonces responde 201 y persiste activo', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'Galeno Ficticia',
          plan: 'Oro Ficticio',
          cobertura_pct: 80,
        });

      expect(res.status).toBe(201);
      expect(res.body.obra_social).toBe('Galeno Ficticia');
      expect(res.body.plan).toBe('Oro Ficticio');
      expect(res.body.cobertura_pct).toBe(80);
      expect(res.body.activo).toBe(1);
    });

    it('Dado porcentaje fuera de rango o no entero Cuando crea plan Entonces responde 400', async () => {
      const resFueraRango = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Ficticia',
          plan: 'Plan Inv',
          cobertura_pct: 105,
        });
      expect(resFueraRango.status).toBe(400);

      const resDecimal = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Ficticia',
          plan: 'Plan Inv 2',
          cobertura_pct: 50.5,
        });
      expect(resDecimal.status).toBe(400);
    });

    it('Dado usuario recepción o profesional Cuando intenta crear plan Entonces responde 403', async () => {
      const resRecepcion = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['recepcion']))
        .send({
          obra_social: 'OS Rechazada',
          plan: 'Plan',
          cobertura_pct: 50,
        });
      expect(resRecepcion.status).toBe(403);

      const resProf = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['profesional']))
        .send({
          obra_social: 'OS Rechazada 2',
          plan: 'Plan',
          cobertura_pct: 50,
        });
      expect(resProf.status).toBe(403);
    });

    it('Dado una combinación obra_social y plan duplicada Cuando crea plan Entonces responde 409', async () => {
      await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'Unica OS',
          plan: 'Unico Plan',
          cobertura_pct: 60,
        });

      const resDuplicado = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'Unica OS',
          plan: 'Unico Plan',
          cobertura_pct: 80,
        });

      expect(resDuplicado.status).toBe(409);
    });
  });

  describe('PATCH /api/obras-sociales/planes/:id', () => {
    it('Dado administración Cuando actualiza porcentaje de cobertura Entonces responde 200', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Modificable',
          plan: 'Plan Modificable',
          cobertura_pct: 40,
        });

      const res = await request(app)
        .patch(`/api/obras-sociales/planes/${creado.body.id}`)
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_pct: 75 });

      expect(res.status).toBe(200);
      expect(res.body.cobertura_pct).toBe(75);
    });

    it('Dado campo fuera de allowlist Cuando actualiza Entonces responde 400', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Test Allowlist',
          plan: 'Plan Test',
          cobertura_pct: 40,
        });

      const res = await request(app)
        .patch(`/api/obras-sociales/planes/${creado.body.id}`)
        .set('authorization', bearer(['administracion']))
        .send({ campo_inventado: 'hack' });

      expect(res.status).toBe(400);
    });

    it('Dado rol recepción Cuando intenta actualizar plan Entonces responde 403', async () => {
      const res = await request(app)
        .patch('/api/obras-sociales/planes/id-cualquiera')
        .set('authorization', bearer(['recepcion']))
        .send({ cobertura_pct: 50 });

      expect(res.status).toBe(403);
    });

    it('Dado plan inexistente Cuando intenta actualizar Entonces responde 404', async () => {
      const res = await request(app)
        .patch('/api/obras-sociales/planes/id-inexistente-1234')
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_pct: 50 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/obras-sociales/planes/:id', () => {
    it('Dado administración Cuando da de baja lógica un plan Entonces responde 200, no aparece en GET y segunda baja responde 404', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Para Eliminar',
          plan: 'Plan Eliminar',
          cobertura_pct: 50,
        });

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/planes/${creado.body.id}`)
        .set('authorization', bearer(['administracion']));

      expect(resDelete.status).toBe(200);

      // Desaparece de GET
      const resGet = await request(app)
        .get('/api/obras-sociales/planes')
        .set('authorization', bearer(['recepcion']));
      const encontrado = resGet.body.find(
        (p: { id: string }) => p.id === creado.body.id,
      );
      expect(encontrado).toBeUndefined();

      // Segunda baja responde 404
      const resSegunda = await request(app)
        .delete(`/api/obras-sociales/planes/${creado.body.id}`)
        .set('authorization', bearer(['administracion']));
      expect(resSegunda.status).toBe(404);
    });

    it('Dado profesional o recepción Cuando intentan eliminar plan Entonces responde 403', async () => {
      const res = await request(app)
        .delete('/api/obras-sociales/planes/id-plan')
        .set('authorization', bearer(['recepcion']));
      expect(res.status).toBe(403);
    });

    it('Dado plan de baja lógica Cuando se intenta re-crear su combinación obra_social/plan Entonces responde 409 (UNIQUE, Decisión Q5)', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Baja Re-crear',
          plan: 'Plan Baja Re-crear',
          cobertura_pct: 55,
        });
      expect(creado.status).toBe(201);

      const resBaja = await request(app)
        .delete(`/api/obras-sociales/planes/${creado.body.id}`)
        .set('authorization', bearer(['administracion']));
      expect(resBaja.status).toBe(200);

      // Baja lógica: la fila sigue existiendo (con deleted_at sellado y activo=0)
      const fila = db
        .prepare(`SELECT deleted_at, activo FROM obra_social_plan WHERE id = ?`)
        .get(creado.body.id) as { deleted_at: string | null; activo: number };
      expect(fila.deleted_at).not.toBeNull();
      expect(fila.activo).toBe(0);

      // La combinación no puede re-crearse (UNIQUE obra_social, plan de 004)
      const resRecrear = await request(app)
        .post('/api/obras-sociales/planes')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social: 'OS Baja Re-crear',
          plan: 'Plan Baja Re-crear',
          cobertura_pct: 65,
        });
      expect(resRecrear.status).toBe(409);
    });
  });

  describe('Invariancia del snapshot de cobertura_pct (task 4.5, regla PATCH del spec planes)', () => {
    it('Dado una cobertura ya registrada vía service Cuando cambia cobertura_pct del plan Entonces la fila registrada conserva su pct snapshot y sus importes', async () => {
      // Seeds mínimas de agenda (FKs) para registrar el cargo vía POST /coberturas
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
         VALUES ('prof-1', 'Profesional Ficticio Uno', 'MN-11111', 'General', 1, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
         VALUES ('sillon-1', 'Sillón Ficticio Uno', 1, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
         VALUES ('prest-1', 'CONS-01', 'Consulta General Ficticia', 30, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
         VALUES ('pac-1', 'Paciente Ficticio A', '+54 9 11 0000-0001', 'plan-seed-1', 1, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', 'prest-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(now, now);

      // Cargo registrado vía service bajo el pct vigente del plan (100)
      const cargo = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({ turno_id: 'turno-1', monto_total_centavos: 10000 });
      expect(cargo.status).toBe(201);
      expect(cargo.body.cobertura_pct).toBe(100);
      expect(cargo.body.cobertura_centavos).toBe(10000);
      expect(cargo.body.saldo_paciente_centavos).toBe(0);

      // Cambio del porcentaje del plan (100 → 50) vía PATCH de administración
      const resPatch = await request(app)
        .patch('/api/obras-sociales/planes/plan-seed-1')
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_pct: 50 });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body.cobertura_pct).toBe(50);

      // La fila de cobertura ya registrada conserva su snapshot previo (100)
      const resCob = await request(app)
        .get(`/api/obras-sociales/coberturas/${cargo.body.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resCob.status).toBe(200);
      expect(resCob.body.cobertura_pct).toBe(100);
      expect(resCob.body.cobertura_centavos).toBe(10000);
      expect(resCob.body.saldo_paciente_centavos).toBe(0);
    });
  });

  describe('PATCH sobre plan de baja lógica (F7, escenario nominal del spec planes)', () => {
    it('Dado plan dado de baja Cuando PATCH cobertura_pct Entonces responde 404 y el plan no se reactiva ni se modifica', async () => {
      const resDelete = await request(app)
        .delete('/api/obras-sociales/planes/plan-seed-1')
        .set('authorization', bearer(['administracion']));
      expect(resDelete.status).toBe(200);

      const resPatch = await request(app)
        .patch('/api/obras-sociales/planes/plan-seed-1')
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_pct: 10 });
      expect(resPatch.status).toBe(404);

      // El plan no se reactiva ni se modifica (histórico preservado)
      const fila = db
        .prepare(
          `SELECT cobertura_pct, activo, deleted_at
             FROM obra_social_plan WHERE id = 'plan-seed-1'`,
        )
        .get() as {
          cobertura_pct: number;
          activo: number;
          deleted_at: string | null;
        };
      expect(fila.cobertura_pct).toBe(100);
      // La baja lógica (Q5) sella deleted_at y activo = 0: el PATCH no la reactivó
      expect(fila.activo).toBe(0);
      expect(fila.deleted_at).not.toBeNull();
    });
  });
});
