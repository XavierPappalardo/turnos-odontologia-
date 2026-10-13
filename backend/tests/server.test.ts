/**
 * Health check + bootstrap del servidor (spec platform/foundation: health check;
 * design D6). Sin mock: app real con SQLite en memoria (R12).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import { startServer } from '../src/shared/server.js';

describe('GET /api/health', () => {
  it('Dado createApp Cuando GET /api/health Entonces 200 {"status":"ok"}', async () => {
    const db = openDatabase(':memory:');
    try {
      const res = await request(createApp(db)).get('/api/health');
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
