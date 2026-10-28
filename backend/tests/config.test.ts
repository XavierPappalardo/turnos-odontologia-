/**
 * Config fail-fast (spec platform/foundation: configuración por variables de
 * entorno). Sin defaults silenciosos (design D2). Entorno inyectado → sin
 * estado global (skill vitest).
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/shared/config.js';

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
});
