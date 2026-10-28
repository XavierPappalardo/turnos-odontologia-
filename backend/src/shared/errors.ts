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

export type EjeConflicto = 'profesional' | 'sillon' | 'bloqueo';

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
