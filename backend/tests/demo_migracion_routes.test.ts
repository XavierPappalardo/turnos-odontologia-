/**
 * C-20 rutas admin demo/migración (BAJO). Auth/RBAC, flujos seguros, sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { createApp } from '../src/shared/app.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;

function bearer(sub: string, roles: string[]): string {
  return (
    'Bearer ' +
    signToken(
      { sub, tenantId: 'test', roles: roles as never, email: `${sub}@example.test`, type: 'access', ttlSeconds: 900 },
      APP_CONFIG.jwtSecret,
    )
  );
}

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(db, APP_CONFIG);
});
afterEach(() => db.close());

describe('C-20 /api/utilidades', () => {
  it('Dado sin auth Cuando carga demo Entonces 401', async () => {
    const res = await request(app).post('/api/utilidades/demo');
    expect(res.status).toBe(401);
  });

  it('Dado profesional Cuando preview importación Entonces 403', async () => {
    const res = await request(app)
      .post('/api/utilidades/importacion/preview')
      .set('Authorization', bearer('u-pro', ['profesional']))
      .send({ entidad: 'profesionales', formato: 'csv', contenido: 'nombre\nX\n' });
    expect(res.status).toBe(403);
  });

  it('Dado administracion Cuando carga demo Entonces 201 idempotente/seguro', async () => {
    const res = await request(app)
      .post('/api/utilidades/demo')
      .set('Authorization', bearer('u-admin', ['administracion']));
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|telefono_whatsapp|"dni"/i);
  });

  it('Dado administracion Cuando preview CSV válido Entonces 200 sin persistir', async () => {
    const csv = 'id,nombre\nprof-r1,Profesional Ficticio R1\n';
    const res = await request(app)
      .post('/api/utilidades/importacion/preview')
      .set('Authorization', bearer('u-admin', ['administracion']))
      .send({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.status).toBe(200);
    expect(res.body.persistido).toBe(false);
    expect(res.body.filasValidas).toBe(1);
    expect(res.body.errores).toHaveLength(0);
  });

  it('Dado administracion Cuando confirma CSV válido Entonces 201 y persiste', async () => {
    const csv = 'id,nombre\nprof-r2,Profesional Ficticio R2\n';
    const res = await request(app)
      .post('/api/utilidades/importacion/confirmar')
      .set('Authorization', bearer('u-admin', ['administracion']))
      .send({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.status).toBe(201);
    expect(res.body.insertadas).toBe(1);
  });

  it('Dado formato no soportado Cuando preview Entonces error tipado sin volcar contenido sensible', async () => {
    const res = await request(app)
      .post('/api/utilidades/importacion/preview')
      .set('Authorization', bearer('u-admin', ['administracion']))
      .send({ entidad: 'pacientes', formato: 'pdf', contenido: 'nombre,dni\nPersona,123' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/123|Persona/);
  });
});
