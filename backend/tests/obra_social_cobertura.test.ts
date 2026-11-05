/**
 * Tests para la capacidad obras-sociales/cobertura (C-12).
 * Verificación con SQLite real en memoria (R11/R12) y fixtures ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coberturasRouter } from '../src/obras-sociales/coberturas.routes.js';
import { liquidacionesRouter } from '../src/obras-sociales/liquidaciones.routes.js';
import { createErrorHandler } from '../src/shared/error-handler.js';
import { createLogger } from '../src/shared/logger.js';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { AUTH, bearer } from './helpers/agenda-fixtures.js';
import type { Rol } from '../src/shared/types.js';

describe('obras-sociales/cobertura', () => {
  let db: DatabaseSync;
  let app: express.Express;

  const NOW = new Date().toISOString();

  function tokenConProfesional(roles: readonly Rol[], profId: string): string {
    // Nota (D4, C-09): el profesional NO viaja en el JWT; `requireAuth` resuelve
    // `usuario.profesional_id` desde la BD por request. El parámetro documenta
    // al actor y se valida contra el seed ficticio.
    if (profId !== 'prof-1' && profId !== 'prof-2') {
      throw new Error('profesional de prueba inexistente');
    }
    return 'Bearer ' + signToken(
      {
        sub: 'user-prof-1',
        tenantId: 'test',
        roles,
        email: 'prof1@example.test',
        type: 'access',
        ttlSeconds: 900,
      },
      AUTH.jwtSecret,
    );
  }

  beforeEach(() => {
    db = openDatabase(':memory:');

    // 1. Sembrar profesionales, sillón, prestaciones, planes y pacientes primero por FKs
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-1', 'Profesional Ficticio Uno', 'MN-1111', 'General', 1, ?, ?),
              ('prof-2', 'Profesional Ficticio Dos', 'MN-2222', 'General', 1, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW);

    // 2. Usuarios para tokens (ahora con FK a profesional válida)
    db.prepare(
      `INSERT OR IGNORE INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
       VALUES ('user-test-c08', 'bloqueos@example.test', 'hash', 1, NULL, ?, ?),
              ('user-prof-1', 'prof1@example.test', 'hash', 1, 'prof-1', ?, ?)`,
    ).run(NOW, NOW, NOW, NOW);

    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-1', 'Sillón Ficticio Uno', 1, ?, ?)`,
    ).run(NOW, NOW);

    db.prepare(
      `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
       VALUES ('prest-1', 'CONS-01', 'Consulta General Ficticia', 30, ?, ?),
              ('prest-2', 'LIM-01', 'Limpieza Ficticia', 45, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW);

    db.prepare(
      `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
       VALUES ('plan-100', 'OS Ficticia Plena', 'Plan 100', 100, 1, ?, ?),
              ('plan-60', 'OS Ficticia Parcial', 'Plan 60', 60, 1, ?, ?),
              ('plan-50', 'OS Ficticia Media', 'Plan 50', 50, 1, ?, ?),
              ('plan-inactivo', 'OS Inactiva', 'Plan Baja', 50, 0, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);

    db.prepare(
      `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
       VALUES ('pac-con-plan-100', 'Paciente Ficticio A', '+54 9 11 0000-0001', 'plan-100', 1, ?, ?),
              ('pac-con-plan-60', 'Paciente Ficticio B', '+54 9 11 0000-0002', 'plan-60', 1, ?, ?),
              ('pac-con-plan-50', 'Paciente Ficticio C', '+54 9 11 0000-0003', 'plan-50', 1, ?, ?),
              ('pac-sin-plan', 'Paciente Ficticio D', '+54 9 11 0000-0004', NULL, 1, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);

    // Turnos de prueba
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-con-plan-100', 'prest-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-2', 'prof-1', 'sillon-1', 'pac-con-plan-60', 'prest-1', '2026-11-01T11:00:00.000Z', '2026-11-01T11:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-3', 'prof-2', 'sillon-1', 'pac-con-plan-50', 'prest-1', '2026-11-01T12:00:00.000Z', '2026-11-01T12:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-sin-prestacion', 'prof-1', 'sillon-1', 'pac-con-plan-100', NULL, '2026-11-01T14:00:00.000Z', '2026-11-01T14:30:00.000Z', 'confirmado', 'recepcion', ?, ?),
              ('turno-sin-plan', 'prof-1', 'sillon-1', 'pac-sin-plan', 'prest-1', '2026-11-01T15:00:00.000Z', '2026-11-01T15:30:00.000Z', 'confirmado', 'recepcion', ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);

    app = express();
    app.use(express.json());
    app.use('/api/obras-sociales', coberturasRouter(db, AUTH));
    // F2: el flujo nominal usa el endpoint de liquidaciones (borrador por API)
    app.use('/api/obras-sociales', liquidacionesRouter(db, AUTH));
    app.use(createErrorHandler(createLogger(() => {})));
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/obras-sociales/coberturas', () => {
    it('Dado cargo con plan del paciente al 100% Cuando recepción registra Entonces responde 201 con cobertura total y saldo 0', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 50000,
        });

      expect(res.status).toBe(201);
      expect(res.body.cobertura_centavos).toBe(50000);
      expect(res.body.saldo_paciente_centavos).toBe(0);
      expect(res.body.cobertura_pct).toBe(100);
      expect(res.body.moneda).toBe('ARS');
    });

    it('Dado ejemplo FL-04 (5.000.000 con 60%) Cuando registra Entonces responde 201 con 3.000.000 cobertura y 2.000.000 saldo', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-2',
          monto_total_centavos: 5000000,
        });

      expect(res.status).toBe(201);
      expect(res.body.cobertura_centavos).toBe(3000000);
      expect(res.body.saldo_paciente_centavos).toBe(2000000);
      expect(res.body.cobertura_pct).toBe(60);
    });

    it('Dado redondeo con truncamiento BigInt (333 centavos al 50%) Cuando registra Entonces responde 201 con 166 cobertura y 167 saldo (Q1)', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-3',
          monto_total_centavos: 333,
        });

      expect(res.status).toBe(201);
      expect(res.body.cobertura_centavos).toBe(166);
      expect(res.body.saldo_paciente_centavos).toBe(167);
      expect(res.body.cobertura_centavos + res.body.saldo_paciente_centavos).toBe(333);
    });

    it('Dado paciente sin plan y sin plan declarado Cuando intenta registrar Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-sin-plan',
          monto_total_centavos: 10000,
        });

      expect(res.status).toBe(400);
    });

    it('Dado usuario profesional Cuando intenta registrar cobertura Entonces responde 403', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['profesional']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 50000,
        });

      expect(res.status).toBe(403);
    });

    it('Dado campos fuera de allowlist (cobertura_pct_tratamiento o codigo_nomenclador) Cuando envía Entonces responde 400', async () => {
      const resTratamiento = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 50000,
          cobertura_pct_tratamiento: 50,
        });
      expect(resTratamiento.status).toBe(400);

      const resNomenclador = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 50000,
          codigo_nomenclador: 'NOM-101',
        });
      expect(resNomenclador.status).toBe(400);
    });

    it('Dado monto no entero o negativo Cuando envía Entonces responde 400', async () => {
      const resDecimal = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 500.75,
        });
      expect(resDecimal.status).toBe(400);

      const resNegativo = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: -1,
        });
      expect(resNegativo.status).toBe(400);
    });

    it('Dado monto cero Cuando envía Entonces responde 201 con saldo 0 y cobertura 0', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.cobertura_centavos).toBe(0);
      expect(res.body.saldo_paciente_centavos).toBe(0);
    });

    it('Dado turno sin prestación asignada Cuando envía Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-sin-prestacion',
          monto_total_centavos: 5000,
        });

      expect(res.status).toBe(400);
    });

    it('Dado plan incompatible con el paciente del turno Cuando envía Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1', // Paciente tiene plan-100
          obra_social_plan_id: 'plan-60',
          monto_total_centavos: 5000,
        });

      expect(res.status).toBe(400);
    });

    it('Dado turno inexistente Cuando envía Entonces responde 404', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-fantasma-0001',
          monto_total_centavos: 5000,
        });

      expect(res.status).toBe(404);
    });

    it('Dado entrada mayor a Number.MAX_SAFE_INTEGER Cuando envía Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 10_000_000_000_000_000, // 10^16
        });

      expect(res.status).toBe(400);
    });

    it('Dado monto grande con producto intermedio > 2^53 pero en safe integer Cuando envía Entonces calcula exacto', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-3', // plan 50%
          monto_total_centavos: 9_000_000_000_000_000,
        });

      expect(res.status).toBe(201);
      expect(res.body.cobertura_centavos).toBe(4_500_000_000_000_000);
      expect(res.body.saldo_paciente_centavos).toBe(4_500_000_000_000_000);
    });

    it('Dado un turno con cobertura ya registrada Cuando se intenta registrar de nuevo Entonces responde 409', async () => {
      await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 10000,
        });

      const resDuplicado = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 20000,
        });

      expect(resDuplicado.status).toBe(409);
    });

    it('Dado una inserción directa inconsistente en SQLite Cuando se intenta violar el invariante Entonces SQLite aborta', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO obra_social_cobertura_turno (
             id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
             cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at
           ) VALUES (
             'cob-inconsistente', 'turno-1', 'prest-1', 'plan-100', 1000,
             100, 800, 300, 'ARS', ?, ?
           )`,
        ).run(NOW, NOW);
      }).toThrow(/CHECK/i);
    });

    it('Dado plan declarado inexistente Cuando registra el cargo Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-sin-plan', // paciente sin plan asignado
          obra_social_plan_id: 'plan-fantasma-0001',
          monto_total_centavos: 5000,
        });

      expect(res.status).toBe(400);
    });

    it('Dado plan del paciente inactivo (activo=0, sin deleted_at) Cuando registra el cargo Entonces responde 400', async () => {
      db.prepare(
        `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
         VALUES ('pac-plan-baja', 'Paciente Ficticio E', '+54 9 11 0000-0005', 'plan-inactivo', 1, ?, ?)`,
      ).run(NOW, NOW);
      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-plan-baja', 'prof-1', 'sillon-1', 'pac-plan-baja', 'prest-1', '2026-11-01T16:00:00.000Z', '2026-11-01T16:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(NOW, NOW);

      const res = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-plan-baja',
          monto_total_centavos: 5000,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/obras-sociales/coberturas/:id', () => {
    it('Dado cobertura no liquidada Cuando corrige monto Entonces responde 200 y recalcula importes', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-2', // plan 60%
          monto_total_centavos: 100000,
        });

      const resPatch = await request(app)
        .patch(`/api/obras-sociales/coberturas/${creado.body.id}`)
        .set('authorization', bearer(['recepcion']))
        .send({ monto_total_centavos: 50000 });

      expect(resPatch.status).toBe(200);
      expect(resPatch.body.monto_total_centavos).toBe(50000);
      expect(resPatch.body.cobertura_centavos).toBe(30000);
      expect(resPatch.body.saldo_paciente_centavos).toBe(20000);
    });

    it('Dado cobertura incluida en liquidación vigente Cuando intenta PATCH Entonces responde 409', async () => {
      const creado = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 10000,
        });

      // Insertar item de liquidación vinculándolo
      db.prepare(
        `INSERT INTO obra_social_liquidacion (id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at)
         VALUES ('liq-1', 'plan-100', '2026-11-01', '2026-11-30', 'borrador', 10000, 'user-test-c08', ?, ?)`,
      ).run(NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_liquidacion_item (id, liquidacion_id, cobertura_id, turno_id, monto_cobertura_centavos, saldo_paciente_centavos, cobertura_pct, created_at)
         VALUES ('item-1', 'liq-1', ?, 'turno-1', 10000, 0, 100, ?)`,
      ).run(creado.body.id, NOW);

      const resPatch = await request(app)
        .patch(`/api/obras-sociales/coberturas/${creado.body.id}`)
        .set('authorization', bearer(['recepcion']))
        .send({ monto_total_centavos: 20000 });

      expect(resPatch.status).toBe(409);
    });
  });

  describe('GET /api/obras-sociales/coberturas con RBAC', () => {
    it('Dado recepción Cuando lista coberturas Entonces responde 200 con todas y sin PHI', async () => {
      await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 10000,
        });

      const res = await request(app)
        .get('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']));

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).not.toHaveProperty('nombre_paciente');
      expect(res.body[0]).not.toHaveProperty('dni');
    });

    it('Dado profesional Cuando consulta cobertura de turno ajeno Entonces responde 403 y cuando consulta propia responde 200', async () => {
      // turno-1 es de prof-1; turno-3 es de prof-2
      const cob1 = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-1',
          monto_total_centavos: 10000,
        });

      const cob3 = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-3',
          monto_total_centavos: 10000,
        });

      const tokenProf1 = tokenConProfesional(['profesional'], 'prof-1');

      // Acceso a la propia (turno-1)
      const resPropia = await request(app)
        .get(`/api/obras-sociales/coberturas/${cob1.body.id}`)
        .set('authorization', tokenProf1);
      expect(resPropia.status).toBe(200);

      // Acceso a la ajena (turno-3)
      const resAjena = await request(app)
        .get(`/api/obras-sociales/coberturas/${cob3.body.id}`)
        .set('authorization', tokenProf1);
      expect(resAjena.status).toBe(403);
    });

    it('Dado sin token de autenticación Cuando solicita coberturas Entonces responde 401', async () => {
      const res = await request(app).get('/api/obras-sociales/coberturas');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/obras-sociales/coberturas/:id (baja lógica, spec "Único cargo vigente")', () => {
    it('Dado cobertura vigente Cuando se da de baja con DELETE y se re-registra el mismo turno Entonces responde 201 con valores recalculados', async () => {
      const primera = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-2', // plan 60 %
          monto_total_centavos: 30000,
        });
      expect(primera.status).toBe(201);

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/coberturas/${primera.body.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resDelete.status).toBe(200);

      // El cargo de baja ya no es visible por GET
      const resGet = await request(app)
        .get(`/api/obras-sociales/coberturas/${primera.body.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resGet.status).toBe(404);

      // Re-registro del mismo turno con valores recién calculados
      const reRegistro = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({
          turno_id: 'turno-2',
          monto_total_centavos: 40000,
        });
      expect(reRegistro.status).toBe(201);
      expect(reRegistro.body.cobertura_centavos).toBe(24000);
      expect(reRegistro.body.saldo_paciente_centavos).toBe(16000);
    });

    it('Dado DELETE sobre cobertura inexistente Cuando se invoca Entonces responde 404', async () => {
      const res = await request(app)
        .delete('/api/obras-sociales/coberturas/cob-fantasma-0001')
        .set('authorization', bearer(['recepcion']));
      expect(res.status).toBe(404);
    });

    it('Dado usuario profesional Cuando intenta DELETE Entonces responde 403', async () => {
      const res = await request(app)
        .delete('/api/obras-sociales/coberturas/cob-fantasma-0001')
        .set('authorization', bearer(['profesional']));
      expect(res.status).toBe(403);
    });
  });

  describe('Correcciones post-auditoría C-12 (F2/F3, guard de baja y PATCH seguro)', () => {
    it('Dado cobertura incluida en borrador vigente generado por API Cuando DELETE Entonces responde 409 y la fila queda intacta (F2)', async () => {
      const cargo = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({ turno_id: 'turno-1', monto_total_centavos: 10000 });
      expect(cargo.status).toBe(201);

      // Borrador generado por API que congela la cobertura (turno-1: 2026-11-01, plan-100)
      const borrador = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-100',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-01T23:59:59.999Z',
        });
      expect(borrador.status).toBe(201);
      expect(borrador.body.items.length).toBe(1);

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/coberturas/${cargo.body.id}`)
        .set('authorization', bearer(['recepcion']));

      expect(resDelete.status).toBe(409);
      expect(resDelete.body.error).toBe('conflicto');

      // La fila queda intacta (sin baja lógica, snapshot preservado)
      const fila = db
        .prepare(
          `SELECT deleted_at, cobertura_pct, cobertura_centavos, saldo_paciente_centavos
             FROM obra_social_cobertura_turno WHERE id = ?`,
        )
        .get(cargo.body.id) as {
          deleted_at: string | null;
          cobertura_pct: number;
          cobertura_centavos: number;
          saldo_paciente_centavos: number;
        };
      expect(fila.deleted_at).toBeNull();
      expect(fila.cobertura_pct).toBe(100);
      expect(fila.cobertura_centavos).toBe(10000);
      expect(fila.saldo_paciente_centavos).toBe(0);
    });

    it('Dado cobertura sin liquidación Cuando DELETE Entonces responde 200 con baja lógica y snapshot intacto (F2)', async () => {
      const cargo = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({ turno_id: 'turno-2', monto_total_centavos: 20000 }); // plan-60
      expect(cargo.status).toBe(201);

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/coberturas/${cargo.body.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resDelete.status).toBe(200);

      const fila = db
        .prepare(
          `SELECT deleted_at, cobertura_pct, cobertura_centavos, saldo_paciente_centavos
             FROM obra_social_cobertura_turno WHERE id = ?`,
        )
        .get(cargo.body.id) as {
          deleted_at: string | null;
          cobertura_pct: number;
          cobertura_centavos: number;
          saldo_paciente_centavos: number;
        };
      expect(fila.deleted_at).not.toBeNull();
      expect(fila.cobertura_pct).toBe(60);
      expect(fila.cobertura_centavos).toBe(12000);
      expect(fila.saldo_paciente_centavos).toBe(8000);
    });

    it('Dado dos escrituras concurrentes del mismo turno Cuando registra cobertura Entonces un 201 + un 409 y una sola fila vigente (F4, 5.5.7, SQLite real sin mocks)', async () => {
      const payload = { turno_id: 'turno-1', monto_total_centavos: 10000 };
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/obras-sociales/coberturas')
          .set('authorization', bearer(['recepcion']))
          .send(payload),
        request(app)
          .post('/api/obras-sociales/coberturas')
          .set('authorization', bearer(['recepcion']))
          .send(payload),
      ]);

      expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([201, 409]);

      const vigentes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_cobertura_turno WHERE turno_id = 'turno-1' AND deleted_at IS NULL`,
        )
        .get() as { n: number };
      expect(vigentes.n).toBe(1);

      const totales = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_cobertura_turno WHERE turno_id = 'turno-1'`,
        )
        .get() as { n: number };
      expect(totales.n).toBe(1); // sin registros huérfanos ni duplicados
    });

    it('Dado cobertura dada de baja Cuando PATCH de monto Entonces responde 404 y la fila de baja no se modifica (F3, update() verificado)', async () => {
      const cargo = await request(app)
        .post('/api/obras-sociales/coberturas')
        .set('authorization', bearer(['recepcion']))
        .send({ turno_id: 'turno-3', monto_total_centavos: 10000 }); // plan-50
      expect(cargo.status).toBe(201);

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/coberturas/${cargo.body.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resDelete.status).toBe(200);

      const resPatch = await request(app)
        .patch(`/api/obras-sociales/coberturas/${cargo.body.id}`)
        .set('authorization', bearer(['recepcion']))
        .send({ monto_total_centavos: 20000 });
      expect(resPatch.status).toBe(404);

      const fila = db
        .prepare(
          `SELECT deleted_at, monto_total_centavos, cobertura_pct
             FROM obra_social_cobertura_turno WHERE id = ?`,
        )
        .get(cargo.body.id) as {
          deleted_at: string | null;
          monto_total_centavos: number;
          cobertura_pct: number;
        };
      expect(fila.deleted_at).not.toBeNull();
      expect(fila.monto_total_centavos).toBe(10000);
      expect(fila.cobertura_pct).toBe(50);
    });
  });
});
