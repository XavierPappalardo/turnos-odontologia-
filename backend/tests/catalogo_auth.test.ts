/**
 * Tests de autenticación, RBAC y validación de tarifas (C-15).
 * Valida que GET /api/prestaciones permita recepción/profesional/admin y
 * que PUT /api/prestaciones/:id/precio sea exclusivo de administracion.
 */
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { signToken } from '../src/auth/tokens.js';
import { PrestacionRepository } from '../src/catalogo/prestacion.repository.js';
import { createApp } from '../src/shared/app.js';
import type { AppConfig } from '../src/shared/config.js';
import { runMigrations } from '../src/shared/migrations.js';
import type { Rol } from '../src/shared/types.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-0001';

const APP_CONFIG: AppConfig = {
  jwtSecret: JWT_SECRET,
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
  portalPaciente: { tokenTtlSeconds: 604800, rateMax: 1000, rateWindowSeconds: 60 },
};

function authHeader(roles: Rol[]): string {
  const token = signToken(
    {
      sub: 'usr-test-id',
      tenantId: 'test',
      roles,
      email: 'usuario@example.test',
      type: 'access',
      ttlSeconds: 900,
    },
    JWT_SECRET,
  );
  return `Bearer ${token}`;
}

describe('RBAC y Gestión de Precios — GET /api/prestaciones y PUT /api/prestaciones/:id/precio', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof createApp>;
  let repo: PrestacionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    app = createApp(db, APP_CONFIG);
    repo = new PrestacionRepository(db);

    repo.insert({
      id: 'pres-auth-1',
      codigo: 'P-AUTH-1',
      nombre: 'Limpieza y Pulido',
      duracion_min: 30,
      precio_base_centavos: 2000000,
      activo: 1,
      deleted_at: null,
    });
  });

  describe('GET /api/prestaciones', () => {
    it('Dado solicitud sin token Cuando consulta /api/prestaciones Entonces 401', async () => {
      const res = await request(app).get('/api/prestaciones');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'no_autenticado' });
    });

    it('Dado usuario recepcion Cuando consulta /api/prestaciones Entonces 200 con lista', async () => {
      const res = await request(app)
        .get('/api/prestaciones')
        .set('Authorization', authHeader(['recepcion']));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].codigo).toBe('P-AUTH-1');
      expect(res.body[0].precio_formateado).toBe('$ 20.000,00');
    });

    it('Dado usuario profesional Cuando consulta /api/prestaciones Entonces 200 con lista', async () => {
      const res = await request(app)
        .get('/api/prestaciones')
        .set('Authorization', authHeader(['profesional']));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('Dado usuario administracion Cuando consulta /api/prestaciones Entonces 200 con lista', async () => {
      const res = await request(app)
        .get('/api/prestaciones')
        .set('Authorization', authHeader(['administracion']));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('PUT /api/prestaciones/:id/precio', () => {
    it('Dado solicitud sin token Cuando intenta actualizar precio Entonces 401', async () => {
      const res = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .send({ precio_base_centavos: 3000000 });

      expect(res.status).toBe(401);
    });

    it('Dado usuario recepcion Cuando intenta actualizar precio Entonces 403 Forbidden', async () => {
      const res = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .set('Authorization', authHeader(['recepcion']))
        .send({ precio_base_centavos: 3000000 });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden' });

      // Verificar que el precio no cambió
      const actual = repo.obtenerPorId('pres-auth-1');
      expect(actual?.precio_base_centavos).toBe(2000000);
    });

    it('Dado usuario profesional Cuando intenta actualizar precio Entonces 403 Forbidden', async () => {
      const res = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .set('Authorization', authHeader(['profesional']))
        .send({ precio_base_centavos: 3000000 });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden' });
    });

    it('Dado usuario administracion Cuando envía precio válido Entonces 200 y actualiza el valor', async () => {
      const res = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .set('Authorization', authHeader(['administracion']))
        .send({ precio_base_centavos: 3500000 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'pres-auth-1',
        precio_base_centavos: 3500000,
        precio_formateado: '$ 35.000,00',
      });

      const leido = repo.obtenerPorId('pres-auth-1');
      expect(leido?.precio_base_centavos).toBe(3500000);
    });

    it('Dado usuario administracion Cuando envía precio negativo o flotante Entonces 400 validacion', async () => {
      const resNeg = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .set('Authorization', authHeader(['administracion']))
        .send({ precio_base_centavos: -100 });

      expect(resNeg.status).toBe(400);
      expect(resNeg.body.error).toBe('validacion');

      const resFloat = await request(app)
        .put('/api/prestaciones/pres-auth-1/precio')
        .set('Authorization', authHeader(['administracion']))
        .send({ precio_base_centavos: 1000.5 });

      expect(resFloat.status).toBe(400);
      expect(resFloat.body.error).toBe('validacion');
    });

    it('Dado usuario administracion Cuando envía id inexistente Entonces 404 not_found', async () => {
      const res = await request(app)
        .put('/api/prestaciones/pres-inexistente/precio')
        .set('Authorization', authHeader(['administracion']))
        .send({ precio_base_centavos: 4000000 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
    });
  });
});
