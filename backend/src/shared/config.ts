/**
 * Configuración desde entorno (design D2): lee `PORT`, `DATABASE_PATH`,
 * `NODE_ENV` y falla temprano ante variable requerida faltante, sin defaults
 * silenciosos (spec platform/foundation). Sin secretos hardcodeados (R15).
 *
 * `loadConfig(env)` es inyectable (recibe el entorno) → testeable sin estado
 * global mutable (skill vitest).
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface AppConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly nodeEnv: NodeEnv;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];

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

  return { port, databasePath, nodeEnv: rawEnv as NodeEnv };
}
