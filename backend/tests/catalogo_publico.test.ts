/**
 * Tests de integración para el endpoint público de catálogo y tarifas (C-15).
 * Valida GET /api/public/prestaciones sin autenticación, retorno de formato ARS
 * y exclusión de prestaciones inactivas.
 */
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/shared/app.js';
import type { AppConfig } from '../src/shared/config.js';
import { runMigrations } from '../src/shared/migrations.js';
import { PrestacionRepository } from '../src/catalogo/prestacion.repository.js';

const APP_CONFIG: AppConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-0001',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 5,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  reservaOnline: {
    anticipacionMinSegundos: 7200,
    rateMax: 1000,
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60,
  },
  recordatorio: {
    t48hHoras: 48,
    t24hHoras: 24,
    canalPredeterminado: 'whatsapp',
  },
  caja: {
    zonaHoraria: 'America/Buenos_Aires',
  },
  mercadopago: {
    habilitado: false,
    ambiente: 'sandbox',
    token: null,
    webhookSecret: null,
  },
  chatbot: {
    simuladoHabilitado: true,
    sessionTtlSeconds: 1800,
    maxIntentosInvalidos: 5,
    rateMax: 1000,
    rateWindowSeconds: 60,
  },
};

describe('GET /api/public/prestaciones — Catálogo público de precios en ARS', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof createApp>;
  let repo: PrestacionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    app = createApp(db, APP_CONFIG);
    repo = new PrestacionRepository(db);
  });

  it('Dado solicitudes anónimas Cuando consulta GET /api/public/prestaciones Entonces responde 200 con lista formateada', async () => {
    repo.insert({
      id: 'pres-1',
      codigo: 'CONS-GEN',
      nombre: 'Consulta Odontológica General',
      duracion_min: 30,
      precio_base_centavos: 1500000,
      activo: 1,
      deleted_at: null,
    });
    repo.insert({
      id: 'pres-2',
      codigo: 'LIMPIEZA',
      nombre: 'Profilaxis y Limpieza Dental',
      duracion_min: 45,
      precio_base_centavos: 2500000,
      activo: 1,
      deleted_at: null,
    });

    const res = await request(app).get('/api/public/prestaciones');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    expect(res.body[0]).toMatchObject({
      id: 'pres-1',
      codigo: 'CONS-GEN',
      nombre: 'Consulta Odontológica General',
      duracion_min: 30,
      precio_base_centavos: 1500000,
      precio_formateado: '$ 15.000,00',
    });

    expect(res.body[1]).toMatchObject({
      id: 'pres-2',
      codigo: 'LIMPIEZA',
      nombre: 'Profilaxis y Limpieza Dental',
      duracion_min: 45,
      precio_base_centavos: 2500000,
      precio_formateado: '$ 25.000,00',
    });
  });

  it('Dado una prestación inactiva Cuando se consulta el catálogo público Entonces no aparece en la lista', async () => {
    repo.insert({
      id: 'pres-activa',
      codigo: 'ACT-01',
      nombre: 'Prestación Activa',
      duracion_min: 30,
      precio_base_centavos: 1000000,
      activo: 1,
      deleted_at: null,
    });
    repo.insert({
      id: 'pres-inactiva',
      codigo: 'INACT-01',
      nombre: 'Prestación Deshabilitada',
      duracion_min: 30,
      precio_base_centavos: 800000,
      activo: 0,
      deleted_at: null,
    });

    const res = await request(app).get('/api/public/prestaciones');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('pres-activa');
  });

  it('Dado un catálogo sin prestaciones cargadas Cuando se consulta Entonces retorna arreglo vacío con 200', async () => {
    const res = await request(app).get('/api/public/prestaciones');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
