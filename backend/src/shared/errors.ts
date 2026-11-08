/**
 * Errores tipificados de crearTurno (design D5).
 * R3: cuerpos con solo ids opacos + `eje`. NUNCA nombres, DNI, teléfonos
 * ni historia clínica.
 */
import type {
  PacienteId,
  ProfesionalId,
  SillonId,
  TurnoId,
} from './types.js';

export type EjeConflicto = 'profesional' | 'sillon' | 'bloqueo' | 'anticipacion';

export type CrearTurnoErrorCode = 'validacion' | 'forbidden' | 'conflicto';

/**
 * Error base tipado del cimiento (design D5). El middleware centralizado lo
 * traduce a JSON con su `status`; nunca expone stack ni detalles internos.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: { status: number; code: string; message: string }) {
    super(args.message);
    this.name = 'AppError';
    this.status = args.status;
    this.code = args.code;
  }

  toBody(): Record<string, unknown> {
    return { error: this.code };
  }
}

/** Error de máquina de estados / turno inexistente (C-04). */
export class TurnoEstadoError extends AppError {
  declare readonly status: 400 | 403 | 404 | 409;
  readonly desde?: string | undefined;
  readonly hacia?: string | undefined;

  constructor(args: {
    status: 400 | 403 | 404 | 409;
    code: 'validacion' | 'forbidden' | 'not_found' | 'transicion_invalida';
    message: string;
    desde?: string;
    hacia?: string;
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'TurnoEstadoError';
    this.desde = args.desde;
    this.hacia = args.hacia;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.desde !== undefined) body['desde'] = this.desde;
    if (this.hacia !== undefined) body['hacia'] = this.hacia;
    if (this.code === 'validacion') body['detalle'] = this.message;
    return body;
  }
}

/** Error de autenticación/rate limit (C-03). Nunca revela si el email existe. */
export class AuthError extends AppError {
  declare readonly status: 401 | 429;
  readonly retryAfterSeconds?: number | undefined;

  constructor(args: {
    status: 401 | 429;
    code: 'credenciales_invalidas' | 'demasiados_intentos';
    message: string;
    retryAfterSeconds?: number;
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'AuthError';
    this.retryAfterSeconds = args.retryAfterSeconds;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.retryAfterSeconds !== undefined) {
      body['retry_after'] = this.retryAfterSeconds;
    }
    return body;
  }
}

export type BloqueoErrorCode =
  | 'validacion'
  | 'forbidden'
  | 'not_found'
  | 'conflicto';

/**
 * Error tipado del CRUD de bloqueos (C-08, design D4).
 * `turno_ids` solo lleva ids opacos; `detalle` solo en `validacion` (R3).
 */
export class BloqueoError extends AppError {
  declare readonly status: 400 | 403 | 404 | 409;
  declare readonly code: BloqueoErrorCode;
  readonly eje?: 'bloqueo' | undefined;
  readonly turnoIds?: readonly TurnoId[] | undefined;

  constructor(args: {
    status: 400 | 403 | 404 | 409;
    code: BloqueoErrorCode;
    message: string;
    eje?: 'bloqueo';
    turnoIds?: readonly TurnoId[];
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'BloqueoError';
    this.eje = args.eje;
    this.turnoIds = args.turnoIds;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.eje !== undefined) body['eje'] = this.eje;
    if (this.turnoIds !== undefined) body['turno_ids'] = this.turnoIds;
    if (this.code === 'validacion') body['detalle'] = this.message;
    return body;
  }
}

export class CrearTurnoError extends AppError {
  declare readonly status: 400 | 403 | 409;
  declare readonly code: CrearTurnoErrorCode;
  readonly eje?: EjeConflicto | undefined;
  /** Solo ids opacos internos (UUID). Sin PHI. */
  readonly ids?:
    | {
        turnoId?: TurnoId;
        profesionalId?: ProfesionalId;
        sillonId?: SillonId;
        pacienteId?: PacienteId;
      }
    | undefined;

  constructor(args: {
    status: 400 | 403 | 409;
    code: CrearTurnoErrorCode;
    message: string;
    eje?: EjeConflicto;
    ids?: {
      turnoId?: TurnoId;
      profesionalId?: ProfesionalId;
      sillonId?: SillonId;
      pacienteId?: PacienteId;
    };
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'CrearTurnoError';
    this.eje = args.eje;
    this.ids = args.ids;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.eje !== undefined) body['eje'] = this.eje;
    if (this.ids !== undefined) body['ids'] = this.ids;
    if (this.code === 'validacion') body['detalle'] = this.message;
    return body;
  }
}

/** Error de validación clínica (400). Sin nombres, detalle clínico ni PHI. */
export class ValidacionClinicaError extends AppError {
  declare readonly status: 400;
  declare readonly code: string;

  constructor(args: { status: 400; code: string; message: string }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'ValidacionClinicaError';
  }

  toBody(): Record<string, unknown> {
    return { error: this.code };
  }
}

/** Error de acceso a HC/odontograma (403) con motivo de denegación. Sin PHI. */
export class AccesoHcError extends AppError {
  declare readonly status: 403;
  declare readonly code: string;
  readonly motivo: string;

  constructor(args: {
    status: 403;
    code: string;
    message: string;
    motivo: 'sin_vinculo' | 'rol_no_autorizado' | 'delegacion_vencida';
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'AccesoHcError';
    this.motivo = args.motivo;
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, motivo: this.motivo };
  }
}

/** Error de enmienda duplicada (409). Sin PHI. */
export class EnmiendaDuplicadaError extends AppError {
  declare readonly status: 409;
  declare readonly code: string;

  constructor(args: { status: 409; code: string; message: string }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'EnmiendaDuplicadaError';
  }

  toBody(): Record<string, unknown> {
    return { error: this.code };
  }
}

/** Error de evento no encontrado (404). Sin PHI. */
export class EventoNoEncontradoError extends AppError {
  declare readonly status: 404;
  declare readonly code: string;

  constructor(args: { status: 404; code: string; message: string }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'EventoNoEncontradoError';
  }

  toBody(): Record<string, unknown> {
    return { error: this.code };
  }
}

/** Error de intento de modificación sobre tabla insert-only (409). Sin PHI. */
export class EventoInmutableError extends AppError {
  declare readonly status: 409;
  declare readonly code: string;

  constructor(args: { status: 409; code: string; message: string }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'EventoInmutableError';
  }

  toBody(): Record<string, unknown> {
    return { error: this.code };
  }
}

/** Códigos de error del dominio de caja (C-11, tasks 5.3/exportados por spec). */
export type CajaErrorCode =
  | 'validacion'
  | 'not_found'
  | 'aplicacion_requerida'
  | 'monto_excede_saldo'
  | 'cobro_os_excede_cobertura'
  | 'idempotencia_conflictos'
  | 'anulacion_inconsistente'
  | 'cierre_duplicado'
  | 'sin_caja_abierta_asignacion'
  | 'mp_no_configurado'
  | 'mp_firma_invalida'
  | 'mp_pago_inexistente'
  | 'mp_pago_no_aprobado'
  | 'mp_pago_no_verificado'
  | 'mp_datos_incongruentes'
  | 'mp_error_proveedor'
  | 'mp_transicion_invalida';

/**
 * Error tipado de caja (C-11). Sin PHI (R3): la respuesta solo lleva el código;
 * `detalle` aparece únicamente en errores de `validacion`.
 */
export class CajaError extends AppError {
  declare readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503;
  declare readonly code: CajaErrorCode;
  readonly detalle?: string | undefined;

  constructor(args: {
    status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503;
    code: CajaErrorCode;
    message: string;
    detalle?: string;
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'CajaError';
    this.detalle = args.detalle;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.code === 'validacion' && this.detalle !== undefined) {
      body['detalle'] = this.detalle;
    }
    return body;
  }
}

/** Códigos de error del dominio de comisiones (C-13, design D10; tasks 1.2). */
export type ComisionErrorCode =
  | 'validacion'
  | 'not_found'
  | 'estado_invalido'
  | 'cobro_ya_liquidado'
  | 'periodo_ya_liquidado'
  | 'sin_configuracion'
  | 'identidad_ya_configurada'
  | 'preview_desactualizado';

/**
 * Error tipado de comisiones (C-13). Sin PHI (R3): la respuesta solo lleva el
 * código; `detalle` aparece únicamente en errores de `validacion`.
 * Mapeo HTTP (task 6.2, design D10): `preview_desactualizado`,
 * `cobro_ya_liquidado`, `periodo_ya_liquidado` y `estado_invalido` → `409`;
 * `not_found` → `404`; `sin_configuracion`/`identidad_ya_configurada`/`validacion` → `422`.
 */
export class ComisionError extends AppError {
  declare readonly status: 400 | 401 | 403 | 404 | 409 | 422;
  declare readonly code: ComisionErrorCode;
  readonly detalle?: string | undefined;

  constructor(args: {
    status: 400 | 401 | 403 | 404 | 409 | 422;
    code: ComisionErrorCode;
    message: string;
    detalle?: string;
  }) {
    super({ status: args.status, code: args.code, message: args.message });
    this.name = 'ComisionError';
    this.detalle = args.detalle;
  }

  toBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.code === 'validacion' && this.detalle !== undefined) {
      body['detalle'] = this.detalle;
    }
    return body;
  }
}
