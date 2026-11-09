/**
 * C-17 4.1/4.2: integración HTTP portal paciente (token, scoping, errores seguros,
 * rate limit, documentos MVP vacío). SQLite real (R12). Dado/Cuando/Entonces. Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../src/shared/repository.js';
import { createApp } from '../src/shared/app.js';
import { PortalAccesoService } from '../src/portal/portalAcceso.service.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';
import type { AppConfig } from '../src/shared/config.js';

const AHORA = '2026-11-10T10:00:00.000Z';
const PAC1 = 'pac-pr-1';
const PAC2 = 'pac-pr-2';
const PROF = 'prof-pr-1';
const SIL = 'sillon-pr-1';

function seed(db: DatabaseSync): void {
  for (const [id, n] of [[PAC1, 'Uno'], [PAC2, 'Dos']] as const) {
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?,?,?,?)`).run(id, `Paciente Ficticio ${n}`, AHORA, AHORA);
  }
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, 'Prof Ficticio', 1, ?, ?)`).run(PROF, AHORA, AHORA);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, 'Sillon Ficticio', 1, ?, ?)`).run(SIL, AHORA, AHORA);
  db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
    VALUES ('t-pr-1',?,?,?,?,?,'reservado','recepcion',?,?)`).run(PROF, SIL, PAC1, '2026-11-15T10:00:00.000Z', '2026-11-15T10:30:00.000Z', AHORA, AHORA);
  db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
    VALUES ('t-pr-2',?,?,?,?,?,'reservado','recepcion',?,?)`).run(PROF, SIL, PAC2, '2026-11-16T10:00:00.000Z', '2026-11-16T10:30:00.000Z', AHORA, AHORA);
  db.prepare(`INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at)
    VALUES ('pre-pr-1', ?, 'borrador', 5000, 0, 5000, ?, ?)`).run(PAC1, AHORA, AHORA);
}

let db: DatabaseSync;
let token1: string;
let token2: string;
beforeEach(() => {
  db = openDatabase(':memory:');
  seed(db);
  const svc = new PortalAccesoService(db);
  token1 = svc.emitir(PAC1, 3600, new Date(AHORA)).token;
  token2 = svc.emitir(PAC2, 3600, new Date(AHORA)).token;
});
afterEach(() => { db.close(); });

function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

describe('Portal paciente API (C-17, 4.1/4.2)', () => {
  it('Dado token válido Cuando consulta mis turnos Entonces devuelve solo turnos del paciente sin PHI', async () => {
    const res = await request(createApp(db, APP_CONFIG)).get('/api/public/portal/turnos').set(auth(token1));
    expect(res.status).toBe(200);
    expect(res.body.turnos).toHaveLength(1);
    expect(res.body.turnos[0].id).toBe('t-pr-1');
    expect(JSON.stringify(res.body)).not.toContain(PAC2);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio/i);
  });

  it('Dado token inválido Cuando consulta Entonces 401 tipado sin datos', async () => {
    const res = await request(createApp(db, APP_CONFIG)).get('/api/public/portal/turnos').set(auth('token-invalido'));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('credenciales_invalidas');
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente|secret|token_hash/i);
  });

  it('Dado token de otro paciente Cuando confirma turno ajeno Entonces rechaza sin filtrar existencia', async () => {
    const res = await request(createApp(db, APP_CONFIG)).post('/api/public/portal/turnos/t-pr-2/confirmar').set(auth(token1)).send({});
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('pac-pr-2');
  });

  it('Dado token válido Cuando confirma turno propio Entonces actualiza estado', async () => {
    const res = await request(createApp(db, APP_CONFIG)).post('/api/public/portal/turnos/t-pr-1/confirmar').set(auth(token1)).send({});
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('confirmado');
  });

  it('Dado token válido Cuando lista presupuestos Entonces solo propios read-only', async () => {
    const res = await request(createApp(db, APP_CONFIG)).get('/api/public/portal/presupuestos').set(auth(token1));
    expect(res.status).toBe(200);
    expect(res.body.presupuestos).toHaveLength(1);
    expect(res.body.presupuestos[0].id).toBe('pre-pr-1');
  });

  it('Dado portal Cuando intenta mutar presupuesto Entonces rechaza (read-only)', async () => {
    const res = await request(createApp(db, APP_CONFIG)).post('/api/public/portal/presupuestos').set(auth(token1)).send({ estado: 'x' });
    expect(res.status).toBe(403);
  });

  it('Dado sección documentos MVP Cuando consulta Entonces lista vacía segura sin PHI/rutas internas', async () => {
    const res = await request(createApp(db, APP_CONFIG)).get('/api/public/portal/documentos').set(auth(token1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ documentos: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/C:\\\\|\/home|\.env|secret|Paciente/i);
  });

  it('Dado límite de tasa excedido Cuando consulta portal Entonces responde control de tasa sin PHI', async () => {
    const cfg: AppConfig = { ...APP_CONFIG, portalPaciente: { ...APP_CONFIG.portalPaciente, rateMax: 2, rateWindowSeconds: 60 } };
    const app = createApp(db, cfg);
    await request(app).get('/api/public/portal/documentos').set(auth(token1));
    await request(app).get('/api/public/portal/documentos').set(auth(token1));
    const res = await request(app).get('/api/public/portal/documentos').set(auth(token1));
    expect([429, 503]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente|secret/i);
  });
});
