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

export interface ReservaOnlineConfig {
  readonly anticipacionMinSegundos: number;
  readonly rateMax: number;
  readonly rateWindowSeconds: number;
  readonly turnoTokenTtlSeconds: number;
}

export interface RecordatorioConfig {
  readonly t48hHoras: number;
  readonly t24hHoras: number;
  readonly canalPredeterminado: 'whatsapp' | 'email';
}

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
  readonly reservaOnline: ReservaOnlineConfig;
  readonly recordatorio: RecordatorioConfig;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL = 15 * 60;
const DEFAULT_REFRESH_TTL = 7 * 24 * 60 * 60;
const DEFAULT_LOGIN_MAX = 5;
const DEFAULT_LOGIN_WINDOW = 60;
const DEFAULT_RESERVA_ONLINE_ANTICIPACION = 7200; // 2 h, ficticio [Supuesto RN-06]
const DEFAULT_RESERVA_ONLINE_RATE_MAX = 10;
const DEFAULT_RESERVA_ONLINE_RATE_WINDOW = 60;
const DEFAULT_TURNO_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días, ficticio [Supuesto]
const DEFAULT_RECORDATORIO_T48H_HORAS = 48; // ficticio [Supuesto FL-03]
const DEFAULT_RECORDATORIO_T24H_HORAS = 24; // ficticio [Supuesto FL-03]
const DEFAULT_RECORDATORIO_CANAL_PREDETERMINADO: 'whatsapp' | 'email' = 'whatsapp';

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
    reservaOnline: {
      anticipacionMinSegundos: positiveInt(
        env,
        'RESERVA_ONLINE_ANTICIPACION_MIN_SEGUNDOS',
        DEFAULT_RESERVA_ONLINE_ANTICIPACION,
      ),
      rateMax: positiveInt(
        env,
        'RESERVA_ONLINE_RATE_MAX',
        DEFAULT_RESERVA_ONLINE_RATE_MAX,
      ),
      rateWindowSeconds: positiveInt(
        env,
        'RESERVA_ONLINE_RATE_WINDOW_SECONDS',
        DEFAULT_RESERVA_ONLINE_RATE_WINDOW,
      ),
      turnoTokenTtlSeconds: positiveInt(
        env,
        'TURN_TOKEN_TTL_SECONDS',
        DEFAULT_TURNO_TOKEN_TTL_SECONDS,
      ),
    },
    recordatorio: {
      t48hHoras: positiveInt(
        env,
        'RECORDATORIO_T48H_HORAS',
        DEFAULT_RECORDATORIO_T48H_HORAS,
      ),
      t24hHoras: positiveInt(
        env,
        'RECORDATORIO_T24H_HORAS',
        DEFAULT_RECORDATORIO_T24H_HORAS,
      ),
      canalPredeterminado: (env['RECORDATORIO_CANAL_PREDETERMINADO'] ??
        DEFAULT_RECORDATORIO_CANAL_PREDETERMINADO) as 'whatsapp' | 'email',
    },
  };
}
