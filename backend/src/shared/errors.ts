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

export class CrearTurnoError extends Error {
  readonly status: 400 | 403 | 409;
  readonly code: CrearTurnoErrorCode;
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
    super(args.message);
    this.name = 'CrearTurnoError';
    this.status = args.status;
    this.code = args.code;
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
