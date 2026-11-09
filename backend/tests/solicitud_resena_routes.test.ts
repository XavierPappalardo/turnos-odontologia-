/**
 * C-19 rutas admin solicitud de reseña: auth/RBAC, respuestas seguras (BAJO).
 * SQLite real (R12), fixtures ficticias (R1), sin PHI (R3/R4).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../src/shared/repository.js';
import { seedMinimo, SEED_IDS } from '../src/shared/seed.js';
import { signToken } from '../src/auth/tokens.js';
import { createApp } from '../src/shared/app.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';

let db: DatabaseSync;

function bearer(sub: string, roles: string[]): string {
  return (
    'Bearer ' +
    signToken(
      { sub, tenantId: 'test', roles: roles as never, email: `${sub}@example.test`, type: 'access', ttlSeconds: 900 },
      APP_CONFIG.jwtSecret,
    )
  );
}

function seedTurnoAtendido(): string {
  const id = 'tur-resena-route-1';
  const t = '2099-11-11T10:00:00.000Z';
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '2099-11-11T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(id, SEED_IDS.profesional, SEED_IDS.sillon, SEED_IDS.paciente, t, t, t);
  db.prepare(
    `INSERT INTO solicitud_resena (id,turno_id,paciente_id,canal,link_ref,estado,motivo_omision,dedupe_clave,ventana_hasta,detalle_json,created_at,updated_at)
     VALUES ('sr-route-1',?,?,'whatsapp','configurada','enviado_simulado',NULL,'resena:turno:${id}',NULL,'{}',?,?)`,
  ).run(id, SEED_IDS.paciente, t, t);
  return id;
}

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(':memory:');
  seedMinimo(db);
  app = createApp(db, APP_CONFIG);
});
afterEach(() => db.close());

describe('C-19 /api/solicitudes-resena', () => {
  it('Dado usuario no autorizado (profesional) Cuando lista solicitudes Entonces 403 sin PHI', async () => {
    seedTurnoAtendido();
    const res = await request(app)
      .get('/api/solicitudes-resena')
      .set('Authorization', bearer('usr-pro-resena', ['profesional']));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|telefono_whatsapp|"nombre"|"dni"/i);
  });

  it('Dado sin autenticación Cuando lista solicitudes Entonces 401', async () => {
    const res = await request(app).get('/api/solicitudes-resena');
    expect(res.status).toBe(401);
  });

  it('Dado administracion autorizado Cuando lista solicitudes Entonces 200 con DTO seguro', async () => {
    seedTurnoAtendido();
    const res = await request(app)
      .get('/api/solicitudes-resena')
      .set('Authorization', bearer('usr-admin-resena', ['administracion']));
    expect(res.status).toBe(200);
    expect(res.body.solicitudes).toHaveLength(1);
    expect(res.body.solicitudes[0]).toMatchObject({
      id: 'sr-route-1',
      turno_id: 'tur-resena-route-1',
      estado: 'enviado_simulado',
      canal: 'whatsapp',
    });
    expect(res.body.solicitudes[0]).not.toHaveProperty('detalle_json');
    expect(res.body.solicitudes[0]).not.toHaveProperty('link_ref');
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|telefono_whatsapp|"nombre"|"dni"|Ficticio Ejemplo/i);
  });

  it('Dado recepcion autorizado Cuando obtiene solicitud por id Entonces 200 seguro', async () => {
    seedTurnoAtendido();
    const res = await request(app)
      .get('/api/solicitudes-resena/sr-route-1')
      .set('Authorization', bearer('usr-recep-resena', ['recepcion']));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('enviado_simulado');
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|telefono_whatsapp|"nombre"|"dni"/i);
  });

  it('Dado solicitud inexistente Cuando obtiene por id Entonces 404 tipado sin PHI', async () => {
    const res = await request(app)
      .get('/api/solicitudes-resena/no-existe')
      .set('Authorization', bearer('usr-admin-resena', ['administracion']));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|telefono_whatsapp|"nombre"|"dni"/i);
  });
});
