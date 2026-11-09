/**
 * Health check + bootstrap del servidor (spec platform/foundation: health check;
 * design D6). Sin mock: app real con SQLite en memoria (R12).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/shared/app.js';
import { signToken } from '../src/auth/tokens.js';
import { openDatabase } from '../src/shared/repository.js';
import { startServer } from '../src/shared/server.js';
import type { AuthConfig } from '../src/auth/types.js';
import type { AppConfig } from '../src/shared/config.js';

const AUTH: AuthConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-0001',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 5,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

const APP_CONFIG: AppConfig = {
  ...AUTH,
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

describe('GET /api/health', () => {
  it('Dado createApp Cuando GET /api/health Entonces 200 {"status":"ok"}', async () => {
    const db = openDatabase(':memory:');
    try {
      const res = await request(createApp(db, APP_CONFIG)).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    } finally {
      db.close();
    }
  });
});

describe('startServer', () => {
  it('Dado PORT efímero Cuando arranco Entonces escucha, responde health y cierra limpio', async () => {
    const server = startServer({
      PORT: '0',
      DATABASE_PATH: ':memory:',
      NODE_ENV: 'test',
      JWT_SECRET: AUTH.jwtSecret,
    });
    try {
      await new Promise<void>((resolve) => {
        if (server.httpServer.listening) {
          resolve();
          return;
        }
        server.httpServer.once('listening', () => resolve());
      });
      expect(server.port()).toBeGreaterThan(0);
      const res = await request(server.httpServer).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    } finally {
      await server.close();
    }
  });
});

/**
 * Prueba breve de integración del montaje de rutas de obras sociales
 * (C-12, task 7.1): los routers quedan accesibles bajo /api/obras-sociales/*
 * con su auth/RBAC activo. Suite completa por capacidad en los tests C-12.
 */
describe('obras-sociales montadas en createApp (C-12, task 7.1)', () => {
  it('Dado GET /api/obras-sociales/planes sin token Entonces 401 (router montado y autenticado)', async () => {
    const db = openDatabase(':memory:');
    try {
      const res = await request(createApp(db, APP_CONFIG)).get(
        '/api/obras-sociales/planes',
      );
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'no_autenticado' });
    } finally {
      db.close();
    }
  });

  it('Dado token válido de administración Cuando GET liquidación inexistente Entonces 404 (router montado y llega al service)', async () => {
    const db = openDatabase(':memory:');
    try {
      const token =
        'Bearer ' +
        signToken(
          {
            sub: 'user-os-smoke',
            tenantId: 'test',
            roles: ['administracion'],
            email: 'os-smoke@example.test',
            type: 'access',
            ttlSeconds: 900,
          },
          AUTH.jwtSecret,
        );
      const res = await request(createApp(db, APP_CONFIG))
        .get('/api/obras-sociales/liquidaciones/liquidacion-inexistente-404')
        .set('authorization', token);
      expect(res.status).toBe(404);
    } finally {
      db.close();
    }
  });
});

/**
 * Smoke del montaje de comisiones (C-13, task 6.1): routers accesibles bajo
 * /api/comisiones/* con su auth/RBAC activo (401 sin token; 403 de recepción
 * en configuración). Suite E2E completa en comisiones_routes.test.ts.
 */
describe('comisiones montadas en createApp (C-13, task 6.1)', () => {
  it('Dado GET /api/comisiones/liquidaciones sin token Entonces 401 (router montado y autenticado)', async () => {
    const db = openDatabase(':memory:');
    try {
      const res = await request(createApp(db, APP_CONFIG)).get(
        '/api/comisiones/liquidaciones',
      );
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'no_autenticado' });
    } finally {
      db.close();
    }
  });

  it('Dado token válido de recepción Cuando PUT configuraciones Entonces 403 (R4: recepción NO configura comisiones)', async () => {
    const db = openDatabase(':memory:');
    try {
      const token =
        'Bearer ' +
        signToken(
          {
            sub: 'user-com-smoke-rec',
            tenantId: 'test',
            roles: ['recepcion'],
            email: 'com-smoke-rec@example.test',
            type: 'access',
            ttlSeconds: 900,
          },
          AUTH.jwtSecret,
        );
      const res = await request(createApp(db, APP_CONFIG))
        .put('/api/comisiones/configuraciones/prof-ficticio-smoke')
        .set('authorization', token)
        .send({ pct_general: 40, tratamientos: [] });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden' });
    } finally {
      db.close();
    }
  });
});
