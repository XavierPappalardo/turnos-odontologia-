/**
 * Tests para la capacidad obras-sociales/liquidacion (C-12).
 * Verificación con SQLite real en memoria (R11/R12) y fixtures ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liquidacionesRouter } from '../src/obras-sociales/liquidaciones.routes.js';
import { createErrorHandler } from '../src/shared/error-handler.js';
import { createLogger, defaultSink } from '../src/shared/logger.js';
import { openDatabase } from '../src/shared/repository.js';
import { AUTH, bearer } from './helpers/agenda-fixtures.js';

describe('obras-sociales/liquidacion', () => {
  let db: DatabaseSync;
  let app: express.Express;

  const NOW = new Date().toISOString();

  beforeEach(() => {
    db = openDatabase(':memory:');

    // 1. Sembrar entidades base necesarias
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-1', 'Profesional Ficticio Uno', 'MN-1111', 'General', 1, ?, ?)`,
    ).run(NOW, NOW);

    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-1', 'Sillón Ficticio Uno', 1, ?, ?)`,
    ).run(NOW, NOW);

    db.prepare(
      `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
       VALUES ('prest-1', 'CONS-01', 'Consulta General Ficticia', 30, ?, ?)`,
    ).run(NOW, NOW);

    db.prepare(
      `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
       VALUES ('plan-A', 'OS Alpha Ficticia', 'Plan A', 80, 1, ?, ?),
              ('plan-B', 'OS Beta Ficticia', 'Plan B', 50, 1, ?, ?),
              ('plan-inactivo', 'OS Inactiva', 'Plan Baja', 50, 0, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW);

    db.prepare(
      `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
       VALUES ('pac-A', 'Paciente Ficticio A', '+54 9 11 0000-0001', 'plan-A', 1, ?, ?),
              ('pac-B', 'Paciente Ficticio B', '+54 9 11 0000-0002', 'plan-B', 1, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW);

    // 2. Usuarios para tokens
    db.prepare(
      `INSERT OR IGNORE INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
       VALUES ('user-test-c08', 'bloqueos@example.test', 'hash', 1, NULL, ?, ?)`,
    ).run(NOW, NOW);

    // 3. Sembrar turnos con distintas fechas y estados
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('turno-atendido-1', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-05T10:00:00.000Z', '2026-11-05T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-atendido-2', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-10T10:00:00.000Z', '2026-11-10T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-confirmado-nov', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-12T10:00:00.000Z', '2026-11-12T10:30:00.000Z', 'confirmado', 'recepcion', ?, ?),
              ('turno-fuera-rango', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-12-05T10:00:00.000Z', '2026-12-05T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
              ('turno-plan-b', 'prof-1', 'sillon-1', 'pac-B', 'prest-1', '2026-11-07T10:00:00.000Z', '2026-11-07T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);

    // 4. Sembrar coberturas asociadas
    // cob-1: turno 2026-11-05 (atendido, plan-A) -> cobertura 8.000
    // cob-2: turno 2026-11-10 (atendido, plan-A) -> cobertura 12.000
    // cob-3: turno 2026-11-12 (confirmado, plan-A) -> NO DEBE ENTRAR (Q4)
    // cob-4: turno 2026-12-05 (fuera de rango noviembre, plan-A) -> NO DEBE ENTRAR EN NOVIEMBRE
    // cob-5: turno 2026-11-07 (atendido, plan-B) -> NO DEBE ENTRAR EN PLAN-A
    db.prepare(
      `INSERT INTO obra_social_cobertura_turno (id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos, cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at)
       VALUES ('cob-1', 'turno-atendido-1', 'prest-1', 'plan-A', 10000, 80, 8000, 2000, 'ARS', '2026-10-01T10:00:00.000Z', ?),
              ('cob-2', 'turno-atendido-2', 'prest-1', 'plan-A', 15000, 80, 12000, 3000, 'ARS', '2026-11-10T11:00:00.000Z', ?),
              ('cob-3', 'turno-confirmado-nov', 'prest-1', 'plan-A', 10000, 80, 8000, 2000, 'ARS', ?, ?),
              ('cob-4', 'turno-fuera-rango', 'prest-1', 'plan-A', 20000, 80, 16000, 4000, 'ARS', ?, ?),
              ('cob-5', 'turno-plan-b', 'prest-1', 'plan-B', 10000, 50, 5000, 5000, 'ARS', ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);

    app = express();
    app.use(express.json());
    app.use('/api/obras-sociales', liquidacionesRouter(db, AUTH));
    app.use(createErrorHandler(createLogger(() => {})));
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/obras-sociales/liquidaciones (generación de borrador)', () => {
    it('Dado coberturas elegibles en el período Cuando administración genera borrador Entonces responde 201 con total exacto y evento generada (Q1, Q2, Q3, Q4)', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.liquidacion.estado).toBe('borrador');
      // Debe incluir exactamente cob-1 (8000) y cob-2 (12000) = 20000
      expect(res.body.liquidacion.monto_total_centavos).toBe(20000);
      expect(res.body.items.length).toBe(2);

      // Evento inicial 'generada'
      expect(res.body.eventos.length).toBe(1);
      expect(res.body.eventos[0].evento).toBe('generada');
      expect(res.body.eventos[0].actor_usuario_id).toBe('user-test-c08');
      expect(res.body.eventos[0]).not.toHaveProperty('detalle');
    });

    it('Dado turnos en estado confirmado en el período Cuando genera borrador Entonces los excluye (Q4)', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      expect(res.status).toBe(201);
      const turnosEnLiquidacion = res.body.items.map(
        (i: { turno_id: string }) => i.turno_id,
      );
      expect(turnosEnLiquidacion).not.toContain('turno-confirmado-nov');
    });

    it('Dado cobertura registrada en octubre pero con turno.inicio en noviembre Cuando genera noviembre Entonces se incluye por fecha de atención (Q3)', async () => {
      // cob-1 tiene created_at en octubre, pero su turno.inicio es 2026-11-05
      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      expect(res.status).toBe(201);
      const items = res.body.items.map((i: { cobertura_id: string }) => i.cobertura_id);
      expect(items).toContain('cob-1');
    });

    it('Dado período sin coberturas elegibles Cuando intenta generar borrador Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-01-01T00:00:00.000Z',
          hasta: '2026-01-31T23:59:59.999Z',
        });

      expect(res.status).toBe(400);
    });

    it('Dado rango con desde > hasta Cuando intenta generar borrador Entonces responde 400', async () => {
      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-30T00:00:00.000Z',
          hasta: '2026-11-01T00:00:00.000Z',
        });

      expect(res.status).toBe(400);
    });

    it('Dado rol recepción o profesional Cuando intenta generar liquidación Entonces responde 403', async () => {
      const resRecepcion = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['recepcion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(resRecepcion.status).toBe(403);
    });

    it('Dado liquidación existente para el mismo plan y período Cuando intenta generar duplicada Entonces responde 409', async () => {
      const payload = {
        obra_social_plan_id: 'plan-A',
        desde: '2026-11-01T00:00:00.000Z',
        hasta: '2026-11-30T23:59:59.999Z',
      };

      const resPrimera = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send(payload);
      expect(resPrimera.status).toBe(201);

      const resSegunda = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send(payload);
      expect(resSegunda.status).toBe(409);
    });

    it('Dado liquidación vigente Cuando administración la da de baja con DELETE Entonces cabecera e ítems quedan de baja no nula y liberan el guard (misma transacción, 6.5)', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(creada.status).toBe(201);
      const liqId = creada.body.liquidacion.id;

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/liquidaciones/${liqId}`)
        .set('authorization', bearer(['administracion']));
      expect(resDelete.status).toBe(200);

      // Cabecera e ítems quedan de baja (servicio garantiza la misma transacción)
      const itemsDeBaja = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_liquidacion_item WHERE liquidacion_id = ? AND deleted_at IS NOT NULL`,
        )
        .get(liqId) as { n: number };
      expect(itemsDeBaja.n).toBe(2);

      const cabecera = db
        .prepare(
          `SELECT deleted_at FROM obra_social_liquidacion WHERE id = ?`,
        )
        .get(liqId) as { deleted_at: string | null };
      expect(cabecera.deleted_at).not.toBeNull();

      // El detalle ya no es visible (liquidación de baja)
      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${liqId}`)
        .set('authorization', bearer(['administracion']));
      expect(resDetalle.status).toBe(404);
    });

    it('Dado liquidación dada de baja con DELETE Cuando se re-emite el mismo período Entonces responde 201 (líquida turnos que liberó, spec re-emisión)', async () => {
      const payload = {
        obra_social_plan_id: 'plan-A',
        desde: '2026-11-01T00:00:00.000Z',
        hasta: '2026-11-30T23:59:59.999Z',
      };

      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send(payload);
      expect(creada.status).toBe(201);

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}`)
        .set('authorization', bearer(['administracion']));
      expect(resDelete.status).toBe(200);

      // El guard os_item_turno_liquidado_unico queda liberado (ítems de baja)
      const guardLibre = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_liquidacion_item WHERE turno_id = 'turno-atendido-1' AND deleted_at IS NULL`,
        )
        .get() as { n: number };
      expect(guardLibre.n).toBe(0);

      // Re-emisión exitosa del mismo plan/período
      const resReemision = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send(payload);
      expect(resReemision.status).toBe(201);
    });

    it('Dado DELETE sobre id inexistente Cuando se invoca Entonces responde 404', async () => {
      const res = await request(app)
        .delete('/api/obras-sociales/liquidaciones/liq-fantasma-0001')
        .set('authorization', bearer(['administracion']));
      expect(res.status).toBe(404);
    });

    it('Dado rol no autorizado en DELETE Cuando intenta dar de baja Entonces responde 403', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const resDelete = await request(app)
        .delete(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}`)
        .set('authorization', bearer(['recepcion']));
      expect(resDelete.status).toBe(403);
    });
  });

  describe('POST /api/obras-sociales/liquidaciones (regeneración solapada y guard BD, task 6.5.7)', () => {
    it('Dado liquidación noviembre vigente Cuando genera otra que solapa el período Entonces excluye los turnos ya liquidados', async () => {
      const primera = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(primera.status).toBe(201);

      const segunda = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-05T00:00:00.000Z',
          hasta: '2026-12-31T23:59:59.999Z',
        });

      expect(segunda.status).toBe(201);
      const turnosSegunda = segunda.body.items.map(
        (i: { turno_id: string }) => i.turno_id,
      );
      expect(turnosSegunda).toEqual(['turno-fuera-rango']);
      expect(segunda.body.liquidacion.monto_total_centavos).toBe(16000);
    });

    it('Dado intento directo de ítem para un turno ya liquidado Entonces SQLite rechaza por el índice único parcial', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(creada.status).toBe(201);
      const liqId = creada.body.liquidacion.id;

      expect(() => {
        db.prepare(
          `INSERT INTO obra_social_liquidacion_item
             (id, liquidacion_id, cobertura_id, turno_id, monto_cobertura_centavos, saldo_paciente_centavos, cobertura_pct, created_at)
           VALUES ('item-duplicado', ?, 'cob-1', 'turno-atendido-1', 8000, 2000, 80, ?)`,
        ).run(liqId, NOW);
      }).toThrow(/UNIQUE/i);
    });
  });

  describe('PATCH /api/obras-sociales/liquidaciones/:id/estado (máquina de estados)', () => {
    it('Dado borrador Cuando transiciona a presentada y luego a pagada Entonces responde 200 y registra eventos correspondientes (Q2)', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const liqId = creada.body.liquidacion.id;

      // 1. Borrador -> Presentada
      const resPresentada = await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'presentada' });

      expect(resPresentada.status).toBe(200);
      expect(resPresentada.body.estado).toBe('presentada');

      // 2. Presentada -> Pagada
      const resPagada = await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'pagada' });

      expect(resPagada.status).toBe(200);
      expect(resPagada.body.estado).toBe('pagada');

      // Consultar detalle para verificar el historial append-only
      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${liqId}`)
        .set('authorization', bearer(['administracion']));

      expect(resDetalle.body.eventos.length).toBe(3);
      expect(resDetalle.body.eventos.map((e: { evento: string }) => e.evento)).toEqual([
        'generada',
        'presentada',
        'pagada',
      ]);
    });

    it('Dado borrador Cuando intenta atajo directo a pagada Entonces responde 409', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const resAtajo = await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'pagada' });

      expect(resAtajo.status).toBe(409);
    });

    it('Dado liquidación en estado pagada Cuando intenta transicionar Entonces responde 409 por estado terminal', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const liqId = creada.body.liquidacion.id;
      await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'presentada' });

      await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'pagada' });

      const resTerminal = await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'borrador' });

      expect(resTerminal.status).toBe(409);
    });
  });

  describe('Inmutabilidad de eventos y triggers', () => {
    it('Dado intento de UPDATE o DELETE directo sobre obra_social_liquidacion_evento Entonces trigger aborta la escritura', () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO obra_social_liquidacion (id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at)
         VALUES ('liq-trigger', 'plan-A', '2026-11-01', '2026-11-30', 'borrador', 0, 'user-test-c08', ?, ?)`,
      ).run(now, now);

      db.prepare(
        `INSERT INTO obra_social_liquidacion_evento (id, liquidacion_id, evento, actor_usuario_id, ocurrido_en, created_at)
         VALUES ('ev-1', 'liq-trigger', 'generada', 'user-test-c08', ?, ?)`,
      ).run(now, now);

      // Intento de UPDATE
      expect(() => {
        db.prepare(
          `UPDATE obra_social_liquidacion_evento SET evento = 'presentada' WHERE id = 'ev-1'`,
        ).run();
      }).toThrow(/insert-only/i);

      // Intento de DELETE
      expect(() => {
        db.prepare(
          `DELETE FROM obra_social_liquidacion_evento WHERE id = 'ev-1'`,
        ).run();
      }).toThrow(/insert-only/i);
    });
  });

  describe('POST /api/obras-sociales/liquidaciones/:id/items (agregado de ítems y congelamiento)', () => {
    it('Dado liquidación en borrador Cuando agrega cobertura elegible Entonces responde 200 y actualiza monto total', async () => {
      // Creamos liquidación solo con cob-1 (rango que abarque solo cob-1)
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-15T23:59:59.999Z',
        });

      // Turno atendido adicional en el rango
      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-extra', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-08T10:00:00.000Z', '2026-11-08T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos, cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at)
         VALUES ('cob-extra', 'turno-extra', 'prest-1', 'plan-A', 10000, 80, 8000, 2000, 'ARS', ?, ?)`,
      ).run(NOW, NOW);

      const resAgregar = await request(app)
        .post(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}/items`)
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_id: 'cob-extra' });

      expect(resAgregar.status).toBe(200);

      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}`)
        .set('authorization', bearer(['administracion']));

      expect(resDetalle.body.liquidacion.monto_total_centavos).toBe(
        creada.body.liquidacion.monto_total_centavos + 8000,
      );
    });

    it('Dado liquidación en estado presentada Cuando intenta agregar ítem Entonces responde 409 por congelamiento', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      await request(app)
        .patch(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}/estado`)
        .set('authorization', bearer(['administracion']))
        .send({ estado: 'presentada' });

      const resBloqueado = await request(app)
        .post(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}/items`)
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_id: 'cob-4' });

      expect(resBloqueado.status).toBe(409);
    });

    it('Dado liquidación en borrador del plan A Cuando agrega una cobertura del plan B Entonces responde 400 (congelamiento)', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const resPlanB = await request(app)
        .post(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}/items`)
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_id: 'cob-5' });

      expect(resPlanB.status).toBe(400);
    });

    it('Dado la cobertura ya incluida en otra liquidación vigente Cuando intenta agregarla de nuevo Entonces responde 400 (prevención de duplicados)', async () => {
      const primera = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(primera.status).toBe(201);

      // Borrador de diciembre: cob-1 ya quedó incluida en la primera liquidación
      const borradorDiciembre = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-12-01T00:00:00.000Z',
          hasta: '2026-12-31T23:59:59.999Z',
        });
      expect(borradorDiciembre.status).toBe(201);

      const resDuplicado = await request(app)
        .post(`/api/obras-sociales/liquidaciones/${borradorDiciembre.body.liquidacion.id}/items`)
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_id: 'cob-1' });

      expect(resDuplicado.status).toBe(400);
    });
  });

  describe('Consultas y RBAC de liquidaciones', () => {
    it('Dado recepción o profesional Cuando intenta listar o consultar detalle Entonces responde 403', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      const resListar = await request(app)
        .get('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['recepcion']));
      expect(resListar.status).toBe(403);

      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}`)
        .set('authorization', bearer(['profesional']));
      expect(resDetalle.status).toBe(403);
    });

    it('Dado cambio posterior en el porcentaje del plan Cuando consulta liquidación Entonces los snapshots se mantienen invariantes', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      // Modificamos el plan en la base a 20%
      db.prepare(`UPDATE obra_social_plan SET cobertura_pct = 20 WHERE id = 'plan-A'`).run();

      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${creada.body.liquidacion.id}`)
        .set('authorization', bearer(['administracion']));

      // Los snapshots de los ítems deben conservar 80%
      for (const item of resDetalle.body.items) {
        expect(item.cobertura_pct).toBe(80);
      }
    });
  });

  describe('Correcciones post-auditoría C-12 (F1/F3/F6, obs. lost-update del total)', () => {
    it('Dado borrador vigente Cuando se agregan dos ítems concurrentemente Entonces el total de la cabecera es igual al SUM de los ítems vigentes (sin lost-update, F1)', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(creada.status).toBe(201);
      const totalInicial = creada.body.liquidacion.monto_total_centavos; // 20000

      // Dos coberturas adicionales elegibles (turnos de noviembre distintos: sin
      // conflicto de unicidad entre ellas — el escenario apunta al lost-update
      // del total de la cabecera, no a la unicidad por turno)
      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-extra-1', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-08T10:00:00.000Z', '2026-11-08T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
                ('turno-extra-2', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-09T10:00:00.000Z', '2026-11-09T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos, cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at)
         VALUES ('cob-extra-1', 'turno-extra-1', 'prest-1', 'plan-A', 10000, 80, 8000, 2000, 'ARS', ?, ?),
                ('cob-extra-2', 'turno-extra-2', 'prest-1', 'plan-A', 12000, 80, 9600, 2400, 'ARS', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      const liqId = creada.body.liquidacion.id;
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/obras-sociales/liquidaciones/${liqId}/items`)
          .set('authorization', bearer(['administracion']))
          .send({ cobertura_id: 'cob-extra-1' }),
        request(app)
          .post(`/api/obras-sociales/liquidaciones/${liqId}/items`)
          .set('authorization', bearer(['administracion']))
          .send({ cobertura_id: 'cob-extra-2' }),
      ]);

      // Ambos agregados tienen éxito y ninguno pierde su contribución
      expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([200, 200]);

      // La cabecera quedó coherente con la SUMA de los ítems vigentes (F1)
      const sumaVigente = db
        .prepare(
          `SELECT COALESCE(SUM(monto_cobertura_centavos), 0) AS total
             FROM obra_social_liquidacion_item
            WHERE liquidacion_id = ? AND deleted_at IS NULL`,
        )
        .get(liqId) as { total: number };
      expect(sumaVigente.total).toBe(totalInicial + 8000 + 9600);

      const cabecera = db
        .prepare(
          `SELECT monto_total_centavos AS t FROM obra_social_liquidacion WHERE id = ?`,
        )
        .get(liqId) as { t: number };
      expect(cabecera.t).toBe(sumaVigente.total);

      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${liqId}`)
        .set('authorization', bearer(['administracion']));
      expect(resDetalle.body.items.length).toBe(4);
      expect(resDetalle.body.liquidacion.monto_total_centavos).toBe(
        sumaVigente.total,
      );
    });

    it('Dado coberturas cuya suma de cobertura supera Number.MAX_SAFE_INTEGER Cuando genera borrador Entonces responde 400 monto_no_representable y la transacción hace rollback (F6)', async () => {
      // Plan al 100 % con dos coberturas de 9·10^15 centavos: cada una
      // representable, pero la suma parcial 1.8·10^16 no lo es (F6).
      db.prepare(
        `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
         VALUES ('plan-max', 'OS Límite Ficticia', 'Plan Límite', 100, 1, ?, ?)`,
      ).run(NOW, NOW);

      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-max-1', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-20T10:00:00.000Z', '2026-11-20T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
                ('turno-max-2', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-21T10:00:00.000Z', '2026-11-21T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos, cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at)
         VALUES ('cob-max-1', 'turno-max-1', 'prest-1', 'plan-max', 9000000000000000, 100, 9000000000000000, 0, 'ARS', ?, ?),
                ('cob-max-2', 'turno-max-2', 'prest-1', 'plan-max', 9000000000000000, 100, 9000000000000000, 0, 'ARS', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-max',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('monto_no_representable');

      // Rollback del UnitOfWork: la cabecera y sus ítems nunca llegan a existir
      const cabeceras = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_liquidacion WHERE obra_social_plan_id = 'plan-max'`,
        )
        .get() as { n: number };
      expect(cabeceras.n).toBe(0);

      const items = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_liquidacion_item WHERE cobertura_id IN ('cob-max-1', 'cob-max-2')`,
        )
        .get() as { n: number };
      expect(items.n).toBe(0);
    });

    it('Dado borrador cuyo total ya es MAX_SAFE_INTEGER Cuando agrega un ítem de 5 centavos Entonces responde 400, no agrega el ítem y el total no cambia (F6)', async () => {
      db.prepare(
        `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
         VALUES ('turno-max-item', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-25T10:00:00.000Z', '2026-11-25T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
                ('turno-max-add', 'prof-1', 'sillon-1', 'pac-A', 'prest-1', '2026-11-26T10:00:00.000Z', '2026-11-26T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos, cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at)
         VALUES ('cob-max-item', 'turno-max-item', 'prest-1', 'plan-A', 9007199254740991, 100, 9007199254740991, 0, 'ARS', ?, ?),
                ('cob-max-add', 'turno-max-add', 'prest-1', 'plan-A', 5, 100, 5, 0, 'ARS', ?, ?)`,
      ).run(NOW, NOW, NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_liquidacion (id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at)
         VALUES ('liq-max', 'plan-A', '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z', 'borrador', 9007199254740991, 'user-test-c08', ?, ?)`,
      ).run(NOW, NOW);

      db.prepare(
        `INSERT INTO obra_social_liquidacion_item (id, liquidacion_id, cobertura_id, turno_id, monto_cobertura_centavos, saldo_paciente_centavos, cobertura_pct, created_at)
         VALUES ('item-max', 'liq-max', 'cob-max-item', 'turno-max-item', 9007199254740991, 0, 100, ?)`,
      ).run(NOW);

      const res = await request(app)
        .post('/api/obras-sociales/liquidaciones/liq-max/items')
        .set('authorization', bearer(['administracion']))
        .send({ cobertura_id: 'cob-max-add' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('monto_no_representable');

      // El ítem NO se persistió (rollback) y el total quedó intacto
      const itemsVigentes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM obra_social_liquidacion_item WHERE liquidacion_id = 'liq-max' AND deleted_at IS NULL`,
        )
        .get() as { n: number };
      expect(itemsVigentes.n).toBe(1);

      const total = db
        .prepare(
          `SELECT monto_total_centavos AS t FROM obra_social_liquidacion WHERE id = 'liq-max'`,
        )
        .get() as { t: number };
      expect(total.t).toBe(9007199254740991);
    });

    it('Dado borrador Cuando dos solicitudes concurrentes transicionan a presentada Entonces una 200, una 409 y un solo evento (F3, sin mocks)', async () => {
      const creada = await request(app)
        .post('/api/obras-sociales/liquidaciones')
        .set('authorization', bearer(['administracion']))
        .send({
          obra_social_plan_id: 'plan-A',
          desde: '2026-11-01T00:00:00.000Z',
          hasta: '2026-11-30T23:59:59.999Z',
        });
      expect(creada.status).toBe(201);
      const liqId = creada.body.liquidacion.id;

      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
          .set('authorization', bearer(['administracion']))
          .send({ estado: 'presentada' }),
        request(app)
          .patch(`/api/obras-sociales/liquidaciones/${liqId}/estado`)
          .set('authorization', bearer(['administracion']))
          .send({ estado: 'presentada' }),
      ]);

      // La ganadora aplica la transición; la perdedora choca contra el estado
      // real ya mudado (re-lectura intra-tx) y responde 409
      expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([200, 409]);

      const resDetalle = await request(app)
        .get(`/api/obras-sociales/liquidaciones/${liqId}`)
        .set('authorization', bearer(['administracion']));
      expect(resDetalle.status).toBe(200);
      expect(resDetalle.body.liquidacion.estado).toBe('presentada');

      const eventosPresentada = resDetalle.body.eventos.filter(
        (e: { evento: string }) => e.evento === 'presentada',
      );
      expect(eventosPresentada.length).toBe(1);
    });
  });
});
