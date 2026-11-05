/**
 * Config fail-fast (spec platform/foundation: configuración por variables de
 * entorno). Sin defaults silenciosos (design D2). Entorno inyectado → sin
 * estado global (skill vitest).
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/shared/config.js';
import { fechaContable } from '../src/shared/fechas.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-0001';
const base = {
  PORT: '3000',
  DATABASE_PATH: ':memory:',
  NODE_ENV: 'test',
  JWT_SECRET,
};

describe('loadConfig', () => {
  it('Dado env completo Cuando cargo config Entonces devuelve objeto tipado con port numérico', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(3000);
    expect(cfg.databasePath).toBe(':memory:');
    expect(cfg.nodeEnv).toBe('test');
  });

  it('Dado falta PORT Cuando cargo config Entonces ConfigError nombra PORT (sin default)', () => {
    expect(() => loadConfig({ DATABASE_PATH: ':memory:', NODE_ENV: 'test' })).toThrowError(
      /PORT/,
    );
    try {
      loadConfig({ DATABASE_PATH: ':memory:', NODE_ENV: 'test' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe('PORT');
    }
  });

  it('Dado falta DATABASE_PATH Cuando cargo config Entonces ConfigError nombra DATABASE_PATH', () => {
    expect(() => loadConfig({ PORT: '3000', NODE_ENV: 'test' })).toThrowError(
      /DATABASE_PATH/,
    );
  });

  it('Dado PORT vacío Cuando cargo config Entonces lo trata como faltante', () => {
    expect(() => loadConfig({ ...base, PORT: '   ' })).toThrowError(/PORT/);
  });

  it('Dado PORT no numérico Cuando cargo config Entonces ConfigError sin default', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrowError(/PORT/);
  });

  it('Dado PORT fuera de rango Cuando cargo config Entonces ConfigError', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrowError(/PORT/);
  });

  it('Dado NODE_ENV inválido Cuando cargo config Entonces ConfigError nombra NODE_ENV', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });

  it('Dado falta JWT_SECRET Cuando cargo config Entonces ConfigError nombra JWT_SECRET (sin default)', () => {
    const { JWT_SECRET: _omitido, ...sinSecreto } = base;
    expect(() => loadConfig(sinSecreto)).toThrowError(/JWT_SECRET/);
    try {
      loadConfig(sinSecreto);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe('JWT_SECRET');
    }
  });

  it('Dado JWT_SECRET demasiado corto Cuando cargo config Entonces ConfigError', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'corto' })).toThrowError(/JWT_SECRET/);
  });

  it('Dado auth sin TTLs Cuando cargo config Entonces usa defaults seguros', () => {
    const cfg = loadConfig(base);
    expect(cfg.accessTokenTtlSeconds).toBe(900);
    expect(cfg.refreshTokenTtlSeconds).toBe(604_800);
    expect(cfg.loginRateLimitMax).toBe(5);
    expect(cfg.loginRateLimitWindowSeconds).toBe(60);
    expect(cfg.cookieSecure).toBe(false);
  });

  it('Dado NODE_ENV=production Cuando cargo config Entonces la cookie de refresh exige secure', () => {
    const cfg = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(cfg.cookieSecure).toBe(true);
  });

  it('Dado TTL o rate limit inválidos Cuando cargo config Entonces ConfigError con el nombre de la variable', () => {
    expect(() =>
      loadConfig({ ...base, ACCESS_TOKEN_TTL_SECONDS: '0' }),
    ).toThrowError(/ACCESS_TOKEN_TTL_SECONDS/);
    expect(() =>
      loadConfig({ ...base, REFRESH_TOKEN_TTL_SECONDS: 'abc' }),
    ).toThrowError(/REFRESH_TOKEN_TTL_SECONDS/);
    expect(() =>
      loadConfig({ ...base, LOGIN_RATE_LIMIT_MAX: '-2' }),
    ).toThrowError(/LOGIN_RATE_LIMIT_MAX/);
    expect(() =>
      loadConfig({ ...base, LOGIN_RATE_LIMIT_WINDOW_SECONDS: '0' }),
    ).toThrowError(/LOGIN_RATE_LIMIT_WINDOW_SECONDS/);
  });

  // ── C-11: caja y Mercado Pago ────────────────────────────────────────────

  it('Dado env sin CAJA_ZONA_HORARIA Cuando cargo config Entonces usa el default America/Buenos_Aires sin fallar y la fecha contable se calcula con esa zona', () => {
    const cfg = loadConfig(base);
    expect(cfg.caja.zonaHoraria).toBe('America/Buenos_Aires');
    // La zona default es operativa: computa el día local (diseño D11).
    expect(fechaContable('2026-06-01T15:00:00.000Z', cfg.caja.zonaHoraria)).toBe(
      '2026-06-01',
    );
  });

  it('Dado un alias IANA de la misma zona Cuando cargo config Entonces se acepta tal cual (validación por construcción de Intl)', () => {
    const cfg = loadConfig({
      ...base,
      CAJA_ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
    });
    expect(cfg.caja.zonaHoraria).toBe('America/Argentina/Buenos_Aires');
  });

  it('Dado CAJA_ZONA_HORARIA inexistente Cuando cargo config Entonces ConfigError nombra la variable (fail-fast, sin default silencioso)', () => {
    expect(() =>
      loadConfig({ ...base, CAJA_ZONA_HORARIA: 'Jupiter/Amaltea' }),
    ).toThrowError(/CAJA_ZONA_HORARIA/);
    try {
      loadConfig({ ...base, CAJA_ZONA_HORARIA: 'Jupiter/Amaltea' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe('CAJA_ZONA_HORARIA');
    }
  });

  it('Dado MP_ENV distinto de sandbox Cuando cargo config Entonces ConfigError (sandbox obligatorio, sin cobros reales)', () => {
    expect(() => loadConfig({ ...base, MP_ENV: 'production' })).toThrowError(
      /MP_ENV/,
    );
    try {
      loadConfig({ ...base, MP_ENV: 'production' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variable).toBe('MP_ENV');
    }
  });

  it('Dado arranque sin variables MP Cuando cargo config Entonces la integración queda deshabilitada (habilitado false, credenciales null, ambiente sandbox por default)', () => {
    const cfg = loadConfig(base);
    expect(cfg.mercadopago.habilitado).toBe(false);
    expect(cfg.mercadopago.ambiente).toBe('sandbox');
    expect(cfg.mercadopago.token).toBeNull();
    expect(cfg.mercadopago.webhookSecret).toBeNull();
  });

  it('Dado solo MP_ACCESS_TOKEN sin secreto de firma Cuando cargo config Entonces sigue deshabilitada (falta la mitad del par)', () => {
    const cfg = loadConfig({
      ...base,
      MP_ACCESS_TOKEN: 'TEST-token-ejemplo-no-real',
    });
    expect(cfg.mercadopago.habilitado).toBe(false);
    expect(cfg.mercadopago.webhookSecret).toBeNull();
  });

  it('Dado token de prueba + secreto de firma Cuando cargo config Entonces la integración queda habilitada a nivel config', () => {
    const cfg = loadConfig({
      ...base,
      MP_ACCESS_TOKEN: 'TEST-token-ejemplo-no-real',
      MP_WEBHOOK_SECRET: 'secreto-ejemplo-no-real-c11',
    });
    expect(cfg.mercadopago.habilitado).toBe(true);
    expect(cfg.mercadopago.ambiente).toBe('sandbox');
  });
});
