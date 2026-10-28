/**
 * Máquina de estados mínima de Turno (C-04, KB-04 §9).
 * `reservado → confirmado → presente → atendido`;
 * `reservado|confirmado → cancelado`; `confirmado → ausente`.
 * Cualquier otra transición se rechaza (409).
 */
import type { DatabaseSync } from 'node:sqlite';
import { puedeCambiarEstadoTurno, type Rol } from '../shared/auth.js';
import { TurnoEstadoError } from '../shared/errors.js';
import type { TurnoEstado, TurnoId } from '../shared/types.js';
import { TurnoRepository, type TurnoRow } from './turno.repository.js';

export const TRANSICIONES: Readonly<Record<TurnoEstado, readonly TurnoEstado[]>> = {
  reservado: ['confirmado', 'cancelado'],
  confirmado: ['presente', 'cancelado', 'ausente'],
  presente: ['atendido'],
  atendido: [],
  cancelado: [],
  ausente: [],
};

export function esEstadoValido(valor: string): valor is TurnoEstado {
  return Object.prototype.hasOwnProperty.call(TRANSICIONES, valor);
}

export function puedeTransicionar(
  desde: TurnoEstado,
  hacia: TurnoEstado,
): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export interface CambiarEstadoInput {
  turnoId: string;
  nuevoEstado: string;
  rol: Rol | undefined;
}

export function cambiarEstadoTurno(
  db: DatabaseSync,
  input: CambiarEstadoInput,
): TurnoRow {
  if (!esEstadoValido(input.nuevoEstado)) {
    throw new TurnoEstadoError({
      status: 400,
      code: 'validacion',
      message: 'estado inválido',
    });
  }
  if (!puedeCambiarEstadoTurno(input.rol)) {
    throw new TurnoEstadoError({
      status: 403,
      code: 'forbidden',
      message: 'rol sin permiso para cambiar estados',
    });
  }

  const turnos = new TurnoRepository(db);
  const actual = turnos.findById(input.turnoId) as TurnoRow | undefined;
  if (actual === undefined) {
    throw new TurnoEstadoError({
      status: 404,
      code: 'not_found',
      message: 'turno inexistente',
    });
  }

  if (!puedeTransicionar(actual.estado, input.nuevoEstado)) {
    throw new TurnoEstadoError({
      status: 409,
      code: 'transicion_invalida',
      message: 'transición de estado inválida',
      desde: actual.estado,
      hacia: input.nuevoEstado,
    });
  }

  const actualizado = turnos.actualizarEstado(
    input.turnoId as TurnoId,
    actual.estado,
    input.nuevoEstado,
  );
  if (!actualizado) {
    // Otra escritura cambió el estado entre la lectura y el UPDATE.
    throw new TurnoEstadoError({
      status: 409,
      code: 'transicion_invalida',
      message: 'el turno cambió de estado concurrentemente',
      desde: actual.estado,
      hacia: input.nuevoEstado,
    });
  }

  return turnos.findById(input.turnoId) as TurnoRow;
}
