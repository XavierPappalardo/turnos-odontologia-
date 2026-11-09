/**
 * C-16: integración HTTP del chatbot simulado (supertest, SQLite real).
 * Sin credenciales reales; respuestas/errores sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDatabase } from '../src/shared/repository.js';
import { createApp } from '../src/shared/app.js';
import type { AppConfig } from '../src/shared/config.js';

const AUTH: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c16r',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
  reservaOnline: { anticipacionMinSegundos: 7200, rateMax: 1000, rateWindowSeconds: 60, turnoTokenTtlSeconds: 7 * 24 * 60 * 60 },
  recordatorio: { t48hHoras: 48, t24hHoras: 24, canalPredeterminado: 'whatsapp' },
  caja: { zonaHoraria: 'America/Buenos_Aires' },
  mercadopago: { habilitado: false, ambiente: 'sandbox', token: null, webhookSecret: null },
  chatbot: { simuladoHabilitado: true, sessionTtlSeconds: 1800, maxIntentosInvalidos: 5, rateMax: 1000, rateWindowSeconds: 60 },
};

function seed(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-r-1', 'Prof Ficticio Uno', 1, ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sillon-r-1', 'Sillon Ficticio 1', 1, ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-r-1', 'Paciente Ficticio Uno', ?, ?)`).run(now, now);
}

let db: DatabaseSync;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); });
afterEach(() => { db.close(); });

describe('POST /api/public/chatbot/whatsapp/simulado (C-16)', () => {
  it('Dado entrada inválida sin conversation_id Cuando se invoca Entonces responde 4xx sin PHI', async () => {
    const res = await request(createApp(db, AUTH))
      .post('/api/public/chatbot/whatsapp/simulado')
      .send({ text: 'hola' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toMatch(/Paciente Ficticio|DNI|dni|telefono|secret|token/i);
  });

  it('Dado payload con ID arbitrario tipo PHI Cuando se invoca Entonces rechaza sin eco sensible', async () => {
    const res = await request(createApp(db, AUTH))
      .post('/api/public/chatbot/whatsapp/simulado')
      .send({ conversation_id: 'Juan Perez 30123456', text: 'agendar' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain('Juan Perez');
    expect(JSON.stringify(res.body)).not.toContain('30123456');
  });

  it('Dado mensaje válido simulado Cuando inicia intención Entonces responde 200 con IDs opacos y sin secretos', async () => {
    const res = await request(createApp(db, AUTH))
      .post('/api/public/chatbot/whatsapp/simulado')
      .send({ conversation_id: 'conv-http-1', text: 'agendar' });
    expect(res.status).toBe(200);
    expect(res.body.conversationId ?? res.body.conversation_id).toBe('conv-http-1');
    expect(res.body.code).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|MP_|DNI|Paciente Ficticio/i);
  });

  it('Dado modo simulado sin credenciales externas Cuando agenda con datos opacos y confirmación Entonces crea turno', async () => {
    const app = createApp(db, AUTH);
    const inicio = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 8.5 * 60 * 60 * 1000).toISOString();
    await request(app).post('/api/public/chatbot/whatsapp/simulado').send({ conversation_id: 'conv-http-ag', text: 'agendar' });
    await request(app).post('/api/public/chatbot/whatsapp/simulado').send({
      conversation_id: 'conv-http-ag', text: 'datos',
      paciente_id: 'pac-r-1', profesional_id: 'prof-r-1', sillon_id: 'sillon-r-1', inicio, fin,
    });
    const res = await request(app).post('/api/public/chatbot/whatsapp/simulado').send({
      conversation_id: 'conv-http-ag', text: 'si', confirmar: true,
      paciente_id: 'pac-r-1', profesional_id: 'prof-r-1', sillon_id: 'sillon-r-1', inicio, fin,
    });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('agendado');
    expect(res.body.turnoId ?? res.body.turno_id).toBeDefined();
  });

  it('Dado chatbot deshabilitado por config Cuando se invoca Entonces responde estado simulado/deshabilitado sin exponer secretos', async () => {
    const cfg: AppConfig = { ...AUTH, chatbot: { ...AUTH.chatbot, simuladoHabilitado: false } };
    const res = await request(createApp(db, cfg))
      .post('/api/public/chatbot/whatsapp/simulado')
      .send({ conversation_id: 'conv-http-off', text: 'agendar' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('chatbot_deshabilitado');
    expect(JSON.stringify(res.body)).not.toMatch(/secret|token/i);
  });
});
