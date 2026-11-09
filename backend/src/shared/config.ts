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

/** Configuración de caja (C-11, design D11). */
export interface CajaConfig {
  /** Zona horaria IANA para las fechas contables. Default `America/Buenos_Aires`. */
  readonly zonaHoraria: string;
}

/** Configuración de Mercado Pago (C-11, design D7): solo sandbox. */
export interface MercadoPagoConfig {
  /** Disponible solo con credenciales de prueba y secreto de firma definidos. */
  readonly habilitado: boolean;
  readonly ambiente: 'sandbox';
  /** Access token de prueba del servidor; nunca se expone ni se loguea (R15). */
  readonly token: string | null;
  /** Secreto `MP_WEBHOOK_SECRET` para verificar la firma del webhook (HMAC-SHA256). */
  readonly webhookSecret: string | null;
}

/** Configuración del chatbot WhatsApp simulado (C-16): sin credenciales reales. */
export interface ChatbotConfig {
  /** Modo simulado/estructural habilitado (sin proveedor real). */
  readonly simuladoHabilitado: boolean;
  /** TTL de la sesión conversacional en segundos. */
  readonly sessionTtlSeconds: number;
  /** Máximo de intentos inválidos por conversación antes de limitar. */
  readonly maxIntentosInvalidos: number;
  readonly rateMax: number;
  readonly rateWindowSeconds: number;
}

/** Configuración del portal paciente por token opaco (C-17): sin cuentas/secretos reales. */
export interface PortalPacienteConfig {
  /** TTL del token de acceso al portal en segundos. */
  readonly tokenTtlSeconds: number;
  readonly rateMax: number;
  readonly rateWindowSeconds: number;
}

/** Configuración de recuperación de inactivos y cobranza automática (C-18): sin secretos reales. */
export interface RecuperacionCobranzaConfig {
  readonly habilitado: boolean;
  /** Días sin actividad asistencial relevante para considerar inactivo. */
  readonly inactividadDias: number;
  /** Ventana mínima entre contactos de recuperación (horas). */
  readonly recuperacionVentanaHoras: number;
  /** Ventana mínima entre recordatorios de cobranza (horas). */
  readonly cobranzaVentanaHoras: number;
  /** Máximo de objetivos/contactos por ejecución (seguridad operativa). */
  readonly maxContactosPorEjecucion: number;
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
  readonly caja: CajaConfig;
  readonly mercadopago: MercadoPagoConfig;
  readonly chatbot: ChatbotConfig;
  readonly portalPaciente: PortalPacienteConfig;
  readonly recuperacionCobranza: RecuperacionCobranzaConfig;
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
/**
 * Default de caja (C-11, design D11): identificador canónico en Node 22
 * (normaliza el alias `America/Argentina/Buenos_Aires`). Documentado en
 * `.env.example`; validado al arrancar configurando `Intl.DateTimeFormat`.
 */
const DEFAULT_CAJA_ZONA_HORARIA = 'America/Buenos_Aires';
const MP_ENV_SANDBOX = 'sandbox';
// C-16 chatbot simulado (sin credenciales reales)
const DEFAULT_CHATBOT_SESSION_TTL_SECONDS = 30 * 60; // 30 min
const DEFAULT_CHATBOT_MAX_INTENTOS_INVALIDOS = 5;
const DEFAULT_CHATBOT_RATE_MAX = 30;
const DEFAULT_CHATBOT_RATE_WINDOW_SECONDS = 60;
// C-17 portal paciente (token opaco, sin credenciales reales)
const DEFAULT_PORTAL_PACIENTE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días
const DEFAULT_PORTAL_PACIENTE_RATE_MAX = 60;
const DEFAULT_PORTAL_PACIENTE_RATE_WINDOW_SECONDS = 60;
// C-18 recuperación de inactivos y cobranza automática (sin credenciales reales)
const DEFAULT_RECUPERACION_INACTIVIDAD_DIAS = 180;
const DEFAULT_RECUPERACION_VENTANA_HORAS = 24 * 30;
const DEFAULT_COBRANZA_VENTANA_HORAS = 24 * 7;
const DEFAULT_RECUPERACION_MAX_CONTACTOS = 200;

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

/**
 * Valida la zona horaria IANA de caja (C-11, spec cierre-diario / design D11):
 * la evidencia de soporte es construir un `Intl.DateTimeFormat` con la zona y
 * capturar el error. NO se consulta `Intl.supportedValuesOf` porque no lista
 * todos los alias IANA válidos (p. ej. `America/Argentina/Buenos_Aires`), y un
 * alias válido no se rechaza por ausencia en la lista.
 */
function validarZonaHorariaCaja(env: NodeJS.ProcessEnv): string {
  const raw = env['CAJA_ZONA_HORARIA'];
  const zona = (raw ?? DEFAULT_CAJA_ZONA_HORARIA).trim();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
  } catch {
    throw new ConfigError(
      'CAJA_ZONA_HORARIA',
      `CAJA_ZONA_HORARIA no es una zona horaria IANA soportada, recibido "${zona}"`,
    );
  }
  return zona;
}

/** Lee y valida el modo de Mercado Pago (solo `sandbox`, fail-fast). */
function validarAmbienteMercadoPago(env: NodeJS.ProcessEnv): 'sandbox' {
  const raw = (env['MP_ENV'] ?? MP_ENV_SANDBOX).trim();
  if (raw !== MP_ENV_SANDBOX) {
    throw new ConfigError(
      'MP_ENV',
      `MP_ENV solo admite "${MP_ENV_SANDBOX}" en el cimiento actual (sin exponer valores de credenciales), recibido "${raw}"`,
    );
  }
  return MP_ENV_SANDBOX;
}

/** Lee la configuración de Mercado Pago: deshabilitado sin token o sin secreto de firma. */
function leerMercadoPagoConfig(env: NodeJS.ProcessEnv): MercadoPagoConfig {
  const ambiente = validarAmbienteMercadoPago(env);
  const token = env['MP_ACCESS_TOKEN']?.trim() || null;
  const webhookSecret = env['MP_WEBHOOK_SECRET']?.trim() || null;
  return {
    habilitado: token !== null && webhookSecret !== null,
    ambiente,
    token,
    webhookSecret,
  };
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
    caja: {
      zonaHoraria: validarZonaHorariaCaja(env),
    },
    mercadopago: leerMercadoPagoConfig(env),
    chatbot: {
      simuladoHabilitado:
        (env['CHATBOT_SIMULADO'] ?? 'true').trim().toLowerCase() !== 'false' &&
        (env['CHATBOT_SIMULADO'] ?? 'true').trim() !== '0',
      sessionTtlSeconds: positiveInt(
        env,
        'CHATBOT_SESSION_TTL_SECONDS',
        DEFAULT_CHATBOT_SESSION_TTL_SECONDS,
      ),
      maxIntentosInvalidos: positiveInt(
        env,
        'CHATBOT_MAX_INTENTOS_INVALIDOS',
        DEFAULT_CHATBOT_MAX_INTENTOS_INVALIDOS,
      ),
      rateMax: positiveInt(env, 'CHATBOT_RATE_MAX', DEFAULT_CHATBOT_RATE_MAX),
      rateWindowSeconds: positiveInt(
        env,
        'CHATBOT_RATE_WINDOW_SECONDS',
        DEFAULT_CHATBOT_RATE_WINDOW_SECONDS,
      ),
    },
    portalPaciente: {
      tokenTtlSeconds: positiveInt(
        env,
        'PORTAL_PACIENTE_TOKEN_TTL_SECONDS',
        DEFAULT_PORTAL_PACIENTE_TOKEN_TTL_SECONDS,
      ),
      rateMax: positiveInt(env, 'PORTAL_PACIENTE_RATE_MAX', DEFAULT_PORTAL_PACIENTE_RATE_MAX),
      rateWindowSeconds: positiveInt(
        env,
        'PORTAL_PACIENTE_RATE_WINDOW_SECONDS',
        DEFAULT_PORTAL_PACIENTE_RATE_WINDOW_SECONDS,
      ),
    },
    recuperacionCobranza: {
      habilitado:
        (env['RECUPERACION_COBRANZA_HABILITADO'] ?? 'true').trim().toLowerCase() !== 'false' &&
        (env['RECUPERACION_COBRANZA_HABILITADO'] ?? 'true').trim() !== '0',
      inactividadDias: positiveInt(
        env,
        'RECUPERACION_INACTIVIDAD_DIAS',
        DEFAULT_RECUPERACION_INACTIVIDAD_DIAS,
      ),
      recuperacionVentanaHoras: positiveInt(
        env,
        'RECUPERACION_VENTANA_HORAS',
        DEFAULT_RECUPERACION_VENTANA_HORAS,
      ),
      cobranzaVentanaHoras: positiveInt(
        env,
        'COBRANZA_VENTANA_HORAS',
        DEFAULT_COBRANZA_VENTANA_HORAS,
      ),
      maxContactosPorEjecucion: positiveInt(
        env,
        'RECUPERACION_MAX_CONTACTOS',
        DEFAULT_RECUPERACION_MAX_CONTACTOS,
      ),
    },
  };
}
