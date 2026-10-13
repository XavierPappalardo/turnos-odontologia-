/**
 * Config fail-fast (spec platform/foundation: configuración por variables de
 * entorno). Sin defaults silenciosos (design D2). Entorno inyectado → sin
 * estado global (skill vitest).
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/shared/config.js';

const base = {
  PORT: '3000',
  DATABASE_PATH: ':memory:',
  NODE_ENV: 'test',
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
});
