/**
 * Logger estructurado (design D3): una línea JSON por evento (`level`,
 * `timestamp`, `msg`, `context`). Regla dura (R3/R15): NUNCA emite PHI
 * (nombres, apellido, DNI, teléfonos, historia clínica, email), secretos
 * (tokens, credenciales, `authorization`) ni payloads completos.
 *
 * Inyectable vía `sink` → sin estado global mutable (skill vitest).
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** Destino de las líneas ya serializadas (inyectable en tests). */
export type LogSink = (line: string, level: LogLevel) => void;

export interface LogEntry {
  readonly level: LogLevel;
  readonly timestamp: string;
  readonly msg: string;
  readonly context?: Record<string, unknown>;
}

export interface Logger {
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_DEPTH = 4;

/**
 * Claves cuyo valor NUNCA debe aparecer en un log. Se compara por subcadena
 * normalizada para cubrir variantes (`telefono_whatsapp`, `historia_clinica`).
 */
const SENSITIVE_TOKENS: readonly string[] = [
  'nombre',
  'apellido',
  'dni',
  'documento',
  'telefono',
  'whatsapp',
  'phone',
  'historia',
  'email',
  'correo',
  'password',
  'passwd',
  'contrasena',
  'token',
  'secret',
  'secreto',
  'authorization',
  'cookie',
  'credential',
  'credencial',
  'matricula',
  'payload',
  'body',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_TOKENS.some((token) => normalized.includes(token));
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  return redactObject(value as Record<string, unknown>, depth);
}

function redactObject(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, depth + 1);
  }
  return out;
}

/** Sink por defecto: JSON a stdout/stderr (una línea por evento). */
export function defaultSink(line: string, level: LogLevel): void {
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export function createLogger(
  sink: LogSink,
  now: () => Date = () => new Date(),
): Logger {
  const emit = (
    level: LogLevel,
    msg: string,
    context?: Record<string, unknown>,
  ): void => {
    const entry: LogEntry = {
      level,
      timestamp: now().toISOString(),
      msg,
      ...(context !== undefined ? { context: redactObject(context, 0) } : {}),
    };
    sink(JSON.stringify(entry), level);
  };

  return {
    info: (msg, context) => emit('info', msg, context),
    warn: (msg, context) => emit('warn', msg, context),
    error: (msg, context) => emit('error', msg, context),
  };
}
