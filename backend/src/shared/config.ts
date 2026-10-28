/**
 * Configuración desde entorno (design D2): lee `PORT`, `DATABASE_PATH`,
 * `NODE_ENV`, `JWT_SECRET` y parámetros de auth, y falla temprano ante variable
 * requerida faltante, sin defaults silenciosos para secretos (spec
 * platform/foundation). Sin secretos hardcodeados (R15).
 *
 * `loadConfig(env)` es inyectable (recibe el entorno) → testeable sin estado
 * global mutable (skill vitest).
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface AppConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly nodeEnv: NodeEnv;
  readonly jwtSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly loginRateLimitMax: number;
  readonly loginRateLimitWindowSeconds: number;
  readonly cookieSecure: boolean;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL = 15 * 60;
const DEFAULT_REFRESH_TTL = 7 * 24 * 60 * 60;
const DEFAULT_LOGIN_MAX = 5;
const DEFAULT_LOGIN_WINDOW = 60;

/** Error de configuración: nombra la variable faltante/inválida (fail-fast). */
export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, detail: string) {
    super(`configuración inválida: ${detail}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(name, `falta la variable de entorno requerida "${name}"`);
  }
  return raw.trim();
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(name, `${name} debe ser un entero positivo, recibido "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = requireVar(env, 'PORT');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(
      'PORT',
      `PORT debe ser un entero entre 0 y 65535, recibido "${rawPort}"`,
    );
  }

  const databasePath = requireVar(env, 'DATABASE_PATH');

  const rawEnv = requireVar(env, 'NODE_ENV');
  if (!(NODE_ENVS as readonly string[]).includes(rawEnv)) {
    throw new ConfigError(
      'NODE_ENV',
      `NODE_ENV debe ser uno de ${NODE_ENVS.join(', ')}, recibido "${rawEnv}"`,
    );
  }

  const jwtSecret = requireVar(env, 'JWT_SECRET');
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new ConfigError(
      'JWT_SECRET',
      `JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`,
    );
  }

  const nodeEnv = rawEnv as NodeEnv;
  return {
    port,
    databasePath,
    nodeEnv,
    jwtSecret,
    accessTokenTtlSeconds: positiveInt(
      env,
      'ACCESS_TOKEN_TTL_SECONDS',
      DEFAULT_ACCESS_TTL,
    ),
    refreshTokenTtlSeconds: positiveInt(
      env,
      'REFRESH_TOKEN_TTL_SECONDS',
      DEFAULT_REFRESH_TTL,
    ),
    loginRateLimitMax: positiveInt(
      env,
      'LOGIN_RATE_LIMIT_MAX',
      DEFAULT_LOGIN_MAX,
    ),
    loginRateLimitWindowSeconds: positiveInt(
      env,
      'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      DEFAULT_LOGIN_WINDOW,
    ),
    cookieSecure: nodeEnv === 'production',
  };
}
