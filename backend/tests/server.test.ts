/**
 * Health check + bootstrap del servidor (spec platform/foundation: health check;
 * design D6). Sin mock: app real con SQLite en memoria (R12).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/shared/app.js';
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
