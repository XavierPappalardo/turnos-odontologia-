/**
 * C-03 auth: login, JWT, refresh HttpOnly con rotación/blacklist, logout, me,
 * rate limiting y RBAC real. SQLite real en memoria (R12), datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashToken, signToken, verifyToken } from '../src/auth/tokens.js';
import type { AuthConfig } from '../src/auth/types.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import { seedMinimo, seedUsuarios } from '../src/shared/seed.js';

const PASSWORD = 'Ficticia-1234';
const AUTH: AuthConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c03',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 3_600,
  loginRateLimitMax: 5,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedMinimo(db);
  seedUsuarios(db, PASSWORD);
});

afterEach(() => {
  db.close();
});

function cookieDe(res: SupertestResponse): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined) throw new Error('respuesta sin set-cookie');
  return first.split(';')[0] ?? '';
}

function login(app: ReturnType<typeof createApp>, email: string) {
  return request(app).post('/api/auth/login').send({ email, password: PASSWORD });
}

describe('POST /api/auth/login', () => {
  it('Dado credenciales válidas Cuando login Entonces access token + refresh HttpOnly/Lax', async () => {
    const app = createApp(db, AUTH);
    const res = await login(app, 'recepcion@example.test');
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
    const claims = verifyToken(res.body.access_token, AUTH.jwtSecret, 'access');
    expect(claims?.sub).toBe('user-seed-recepcion');
    expect(claims?.roles).toEqual(['recepcion']);
    expect(claims?.tenant_id).toBe('default');

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/refresh_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('Dado email inexistente o password incorrecta Entonces 401 con el mismo cuerpo (sin enumeración)', async () => {
    const app = createApp(db, AUTH);
    const inexistente = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@example.test', password: PASSWORD });
    const incorrecta = await request(app)
      .post('/api/auth/login')
      .send({ email: 'recepcion@example.test', password: 'Incorrecta-9999' });

    expect(inexistente.status).toBe(401);
    expect(incorrecta.status).toBe(401);
    expect(inexistente.body).toEqual(incorrecta.body);
    expect(JSON.stringify(inexistente.body)).not.toMatch(/example\.test|Ficticio/i);
  });

  it('Dado body incompleto Cuando login Entonces 400', async () => {
    const app = createApp(db, AUTH);
    const res = await request(app).post('/api/auth/login').send({ email: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validacion' });

    const sinBody = await request(app).post('/api/auth/login');
    expect(sinBody.status).toBe(400);
    expect(sinBody.body).toEqual({ error: 'validacion' });
  });

  it('Dado demasiados intentos Cuando login Entonces 429 con Retry-After', async () => {
    const app = createApp(db, { ...AUTH, loginRateLimitMax: 2 });
    await login(app, 'recepcion@example.test');
    await login(app, 'recepcion@example.test');
    const tercero = await login(app, 'recepcion@example.test');
    expect(tercero.status).toBe(429);
    expect(tercero.body.error).toBe('demasiados_intentos');
    expect(tercero.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('Dado access token válido Cuando me Entonces devuelve usuario y roles', async () => {
    const app = createApp(db, AUTH);
    const loginRes = await login(app, 'admin@example.test');
    const res = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${loginRes.body.access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@example.test');
    expect(res.body.user.roles).toEqual(['administracion']);
  });

  it('Dado sin token o token inválido Cuando me Entonces 401', async () => {
    const app = createApp(db, AUTH);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('authorization', 'Bearer token-invalido')
      ).status,
    ).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('Dado refresh válido Cuando refresco Entonces rota el token y emite nuevo access', async () => {
    const app = createApp(db, AUTH);
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: 'recepcion@example.test',
      password: PASSWORD,
    });
    const refreshViejo = cookieDe(loginRes);

    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).not.toBe(loginRes.body.access_token);
    expect(cookieDe(refreshRes)).not.toBe(refreshViejo);
  });

  it('Dado refresh ya usado Cuando lo reutilizo Entonces 401 y revoca la familia', async () => {
    const app = createApp(db, AUTH);
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: 'recepcion@example.test',
      password: PASSWORD,
    });
    const refreshViejo = cookieDe(loginRes);

    // Primer refresh válido (rota).
    expect((await agent.post('/api/auth/refresh')).status).toBe(200);

    // Reutilización del token viejo → blacklist.
    const reuso = await request(app)
      .post('/api/auth/refresh')
      .set('cookie', refreshViejo);
    expect(reuso.status).toBe(401);

    // La familia quedó revocada: el token nuevo tampoco sirve.
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('Dado refresh ausente o inválido Entonces 401', async () => {
    const app = createApp(db, AUTH);
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/refresh')
          .set('cookie', 'refresh_token=invalido')
      ).status,
    ).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('Dado sesión activa Cuando logout Entonces limpia cookie y revoca refresh', async () => {
    const app = createApp(db, AUTH);
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: 'recepcion@example.test',
      password: PASSWORD,
    });
    const refresh = cookieDe(loginRes);

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    const cookie = logout.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/refresh_token=;/);

    const reuso = await request(app)
      .post('/api/auth/refresh')
      .set('cookie', refresh);
    expect(reuso.status).toBe(401);
  });
});

describe('RBAC real sobre agenda (C-03 + C-04)', () => {
  it('Dado recepción Cuando crea turno Entonces 201; profesional recibe 403', async () => {
    const app = createApp(db, AUTH);
    const recepcion = await login(app, 'recepcion@example.test');
    const profesional = await login(app, 'profesional@example.test');
    const payload = {
      profesional_id: 'prof-seed-0001',
      sillon_id: 'sillon-seed-0001',
      paciente_id: 'pac-seed-0001',
      inicio: '2026-11-01T10:00:00.000Z',
      fin: '2026-11-01T10:30:00.000Z',
    };

    const ok = await request(app)
      .post('/api/turnos')
      .set('authorization', `Bearer ${recepcion.body.access_token}`)
      .send(payload);
    expect(ok.status).toBe(201);

    const forbidden = await request(app)
      .post('/api/turnos')
      .set('authorization', `Bearer ${profesional.body.access_token}`)
      .send({ ...payload, inicio: '2026-11-01T11:00:00.000Z', fin: '2026-11-01T11:30:00.000Z' });
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(forbidden.body)).not.toMatch(/Ficticio|Paciente|dni/i);
  });
});

describe('seed de usuarios', () => {
  it('Dado seed ejecutado dos veces Entonces no duplica usuarios y cubre los tres roles', () => {
    seedUsuarios(db, PASSWORD);

    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM usuario').get() as { n: number }
    ).n;
    expect(total).toBe(3);

    const roles = (
      db.prepare('SELECT DISTINCT rol FROM usuario_rol ORDER BY rol').all() as {
        rol: string;
      }[]
    ).map((r) => r.rol);
    expect(roles).toEqual(['administracion', 'profesional', 'recepcion']);
  });

  it('Dado password de seed demasiado corta Entonces se rechaza sin crear usuarios', () => {
    const dbNueva = openDatabase(':memory:');
    try {
      expect(() => seedUsuarios(dbNueva, 'corta')).toThrowError(/corta/i);
      const total = (
        dbNueva.prepare('SELECT COUNT(*) AS n FROM usuario').get() as { n: number }
      ).n;
      expect(total).toBe(0);
    } finally {
      dbNueva.close();
    }
  });
});

describe('tokens y blacklist', () => {  it('Dado token expirado o de otro tipo Entonces verifyToken devuelve undefined', () => {
    const expired = signToken(
      {
        sub: 'u',
        tenantId: 't',
        roles: ['recepcion'],
        email: 'u@example.test',
        type: 'access',
        ttlSeconds: -1,
      },
      AUTH.jwtSecret,
    );
    expect(verifyToken(expired, AUTH.jwtSecret, 'access')).toBeUndefined();

    const refresh = signToken(
      {
        sub: 'u',
        tenantId: 't',
        roles: ['recepcion'],
        email: 'u@example.test',
        type: 'refresh',
        ttlSeconds: 60,
      },
      AUTH.jwtSecret,
    );
    expect(verifyToken(refresh, AUTH.jwtSecret, 'access')).toBeUndefined();
    expect(verifyToken(refresh, AUTH.jwtSecret, 'refresh')).toBeDefined();
  });

  it('hashToken no expone el token en claro', () => {
    const token = 'token-ficticio';
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});
