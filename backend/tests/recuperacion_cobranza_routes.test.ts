/**
 * C-18 2.2/3.2/4.2: endpoints admin recuperación/cobranza (auth/RBAC, respuestas seguras).
 * SQLite real (R12). Dado/Cuando/Entonces. Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../src/shared/repository.js';
import { createApp } from '../src/shared/app.js';
import { signToken } from '../src/auth/tokens.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';

const AHORA = '2026-11-10T12:00:00.000Z';

function bearer(sub: string, roles: string[]): string {
  return 'Bearer ' + signToken({ sub, tenantId: 'test', roles: roles as never, email: `${sub}@example.test`, type: 'access', ttlSeconds: 900 }, APP_CONFIG.jwtSecret);
}

function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at) VALUES ('usr-admin','admin@example.test','hash',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at) VALUES ('usr-recep','recep@example.test','hash',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at) VALUES ('usr-pro','pro@example.test','hash',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO usuario_rol (usuario_id, rol) VALUES ('usr-admin','administracion')`).run();
  db.prepare(`INSERT INTO usuario_rol (usuario_id, rol) VALUES ('usr-recep','recepcion')`).run();
  db.prepare(`INSERT INTO usuario_rol (usuario_id, rol) VALUES ('usr-pro','profesional')`).run();
  db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-r1','Paciente Ficticio Uno',?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-r1','Prof Ficticio',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sil-r1','Sillon Ficticio',1,?,?)`).run(AHORA, AHORA);
  // inactivo (atendido viejo)
  db.prepare(`INSERT INTO turno (id,profesional_id,sillon_id,paciente_id,inicio,fin,estado,origen,created_at,updated_at) VALUES ('t-r1','prof-r1','sil-r1','pac-r1','2025-01-01T10:00:00.000Z','2025-01-01T10:30:00.000Z','atendido','recepcion',?,?)`).run(AHORA, AHORA);
  // deuda
  db.prepare(`INSERT INTO presupuesto (id,paciente_id,estado,total_centavos,cobertura_centavos,saldo_centavos,created_at,updated_at) VALUES ('pre-r1','pac-r1','aceptado',8000,0,8000,?,?)`).run(AHORA, AHORA);
}

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); app = createApp(db, APP_CONFIG); });
afterEach(() => { db.close(); });

describe('C-18 recuperación/cobranza routes (2.2/3.2/4.2)', () => {
  it('Dado usuario no autenticado Cuando consulta inactivos Entonces 401', async () => {
    const res = await request(app).get(`/api/recuperacion-cobranza/inactivos?ahora=${encodeURIComponent(AHORA)}`);
    expect(res.status).toBe(401);
  });

  it('Dado profesional sin autorización Cuando ejecuta campaña Entonces 403 sin PHI', async () => {
    const res = await request(app)
      .post('/api/recuperacion-cobranza/recuperacion/ejecutar')
      .set('Authorization', bearer('usr-pro', ['profesional']))
      .send({ ahora: AHORA });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|DNI|secret/i);
  });

  it('Dado administración Cuando consulta inactivos Entonces devuelve IDs opacos sin PHI', async () => {
    const res = await request(app)
      .get(`/api/recuperacion-cobranza/inactivos?ahora=${encodeURIComponent(AHORA)}`)
      .set('Authorization', bearer('usr-admin', ['administracion']));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.pacientes[0].paciente_id).toBe('pac-r1');
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|nombre/i);
  });

  it('Dado recepción autorizada Cuando ejecuta recuperación Entonces registra ejecución y seguimiento seguro', async () => {
    const res = await request(app)
      .post('/api/recuperacion-cobranza/recuperacion/ejecutar')
      .set('Authorization', bearer('usr-recep', ['recepcion']))
      .send({ ahora: AHORA });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('completada');
    expect(res.body.enviados).toBeGreaterThan(0);

    const det = await request(app)
      .get(`/api/recuperacion-cobranza/ejecuciones/${res.body.id}`)
      .set('Authorization', bearer('usr-admin', ['administracion']));
    expect(det.status).toBe(200);
    expect(det.body.contactos[0].estado).toBe('enviado_simulado');
    expect(JSON.stringify(det.body)).not.toMatch(/Paciente Ficticio|telefono|email@/i);
  });

  it('Dado administración Cuando ejecuta cobranza Entonces genera elegible sin mutar caja y re-ejecución respeta ventana', async () => {
    const pagosAntes = (db.prepare(`SELECT COUNT(*) c FROM pago`).get() as { c: number }).c;
    const r1 = await request(app)
      .post('/api/recuperacion-cobranza/cobranza/ejecutar')
      .set('Authorization', bearer('usr-admin', ['administracion']))
      .send({ ahora: AHORA });
    expect(r1.status).toBe(201);
    expect(r1.body.enviados).toBeGreaterThan(0);
    expect((db.prepare(`SELECT COUNT(*) c FROM pago`).get() as { c: number }).c).toBe(pagosAntes);

    const r2 = await request(app)
      .post('/api/recuperacion-cobranza/cobranza/ejecutar')
      .set('Authorization', bearer('usr-admin', ['administracion']))
      .send({ ahora: '2026-11-12T12:00:00.000Z' });
    expect(r2.status).toBe(201);
    expect(r2.body.omitidos).toBeGreaterThan(0);
  });

  it('Dado profesional Cuando lista ejecuciones Entonces 403', async () => {
    const res = await request(app)
      .get('/api/recuperacion-cobranza/ejecuciones')
      .set('Authorization', bearer('usr-pro', ['profesional']));
    expect(res.status).toBe(403);
  });
});
