/**
 * Acciones de autogestión del portal paciente (C-17, 3.1/3.2).
 * Valida pertenencia del turno al paciente del token y delega a lógica/transiciones
 * existentes (máquina de estados, anticipación RN-06, anti-solapamiento/bloqueos
 * RN-01/02/04, recordatorios) con semántica transaccional segura. Sin PHI.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CrearTurnoError, TurnoEstadoError } from '../shared/errors.js';
import { UnitOfWork } from '../shared/repository.js';
import type { AppConfig } from '../shared/config.js';
import type { PacienteId, PrestacionId, ProfesionalId, SillonId, TurnoEstado, TurnoId } from '../shared/types.js';
import { BloqueoRepository } from '../agenda/bloqueo.repository.js';
import { TurnoRepository, type TurnoRow } from '../agenda/turno.repository.js';
import { puedeTransicionar } from '../agenda/turnoEstado.service.js';
import { normalizarUtc } from '../agenda/crearTurno.service.js';
import { cancelarRecordatoriosDeTurno, programarRecordatoriosSeguro } from '../notificaciones/recordatorio.worker.js';

export type AccionPortalTurno = 'confirmar' | 'cancelar' | 'reprogramar';

export interface AccionPortalInput {
  pacienteId: string;
  turnoId: string;
  accion: AccionPortalTurno;
  nuevoInicio?: string;
  nuevoFin?: string;
}

export interface AccionPortalResultado {
  id: string;
  estado: string;
  origen: string;
  turnoReprogramado?: string;
}

function turnoNoAccesible(): TurnoEstadoError {
  // No filtra existencia de turno ajeno (spec 68-70)
  return new TurnoEstadoError({ status: 404, code: 'not_found', message: 'turno inexistente' });
}

export function ejecutarAccionPortalTurno(
  db: DatabaseSync,
  input: AccionPortalInput,
  config: AppConfig,
  ahora: Date = new Date(),
): AccionPortalResultado {
  const uow = new UnitOfWork(db);
  const turnos = new TurnoRepository(db);
  const ahoraIso = ahora.toISOString();

  const resultado = uow.runInTransaction((): AccionPortalResultado => {
    const actual = turnos.findById(input.turnoId) as TurnoRow | undefined;
    if (!actual) throw turnoNoAccesible();
    if (actual.paciente_id !== input.pacienteId) throw turnoNoAccesible();

    let nuevoEstado: TurnoEstado;
    if (input.accion === 'confirmar') nuevoEstado = 'confirmado';
    else if (input.accion === 'cancelar' || input.accion === 'reprogramar') nuevoEstado = 'cancelado';
    else throw new TurnoEstadoError({ status: 400, code: 'validacion', message: 'acción inválida' });

    if (!puedeTransicionar(actual.estado, nuevoEstado)) {
      throw new TurnoEstadoError({
        status: 409,
        code: 'transicion_invalida',
        message: 'transición de estado inválida',
        desde: actual.estado,
        hacia: nuevoEstado,
      });
    }

    if (input.accion === 'cancelar') {
      const inicioTurno = new Date(actual.inicio);
      const diff = (inicioTurno.getTime() - ahora.getTime()) / 1000;
      if (diff > 0 && diff < config.reservaOnline.anticipacionMinSegundos) {
        throw new CrearTurnoError({
          status: 400,
          code: 'validacion',
          message: 'anticipación mínima no respetada para cancelación',
          eje: 'anticipacion',
        });
      }
    }

    let turnoReprogramadoId: string | undefined;
    if (input.accion === 'reprogramar') {
      if (input.nuevoInicio === undefined || input.nuevoFin === undefined) {
        throw new CrearTurnoError({ status: 400, code: 'validacion', message: 'reprogramar requiere nuevo_inicio y nuevo_fin' });
      }
      const nuevoInicio = normalizarUtc(input.nuevoInicio, 'nuevo_inicio');
      const nuevoFin = normalizarUtc(input.nuevoFin, 'nuevo_fin');
      if (nuevoFin <= nuevoInicio) {
        throw new CrearTurnoError({ status: 400, code: 'validacion', message: 'fin debe ser posterior a inicio' });
      }
      const bloqueos = new BloqueoRepository(db);
      const profesionalId = actual.profesional_id as ProfesionalId;
      const sillonId = actual.sillon_id as SillonId;
      const pacienteId = actual.paciente_id as PacienteId;
      if (turnos.existeSolapeProfesional(profesionalId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'solape por profesional', eje: 'profesional', ids: { profesionalId, sillonId, pacienteId } });
      }
      if (turnos.existeSolapeSillon(sillonId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'solape por sillon', eje: 'sillon', ids: { profesionalId, sillonId, pacienteId } });
      }
      if (bloqueos.existeBloqueoAplicable(profesionalId, sillonId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'bloqueo aplicable', eje: 'bloqueo', ids: { profesionalId, sillonId, pacienteId } });
      }
    }

    const ok = turnos.actualizarEstado(input.turnoId as TurnoId, actual.estado, nuevoEstado);
    if (!ok) {
      throw new TurnoEstadoError({ status: 409, code: 'transicion_invalida', message: 'el turno cambió de estado concurrentemente', desde: actual.estado, hacia: nuevoEstado });
    }
    if (input.accion === 'cancelar' || input.accion === 'reprogramar') {
      cancelarRecordatoriosDeTurno(db, input.turnoId);
    }
    if (input.accion === 'reprogramar') {
      const nuevoId = randomUUID() as TurnoId;
      turnos.crear({
        id: nuevoId,
        profesionalId: actual.profesional_id as ProfesionalId,
        sillonId: actual.sillon_id as SillonId,
        pacienteId: actual.paciente_id as PacienteId,
        prestacionId: (actual.prestacion_id ?? undefined) as PrestacionId | undefined,
        inicio: normalizarUtc(input.nuevoInicio!, 'nuevo_inicio'),
        fin: normalizarUtc(input.nuevoFin!, 'nuevo_fin'),
        estado: 'reservado',
        origen: 'online',
      });
      turnoReprogramadoId = nuevoId;
    }
    // Log operativo sin PHI (solo IDs opacos)
    // eslint-disable-next-line no-console
    console.log(`portal turno ${input.accion} id=${input.turnoId}`);
    const fila = turnos.findById(input.turnoId) as TurnoRow;
    return { id: fila.id, estado: fila.estado, origen: fila.origen, ...(turnoReprogramadoId ? { turnoReprogramado: turnoReprogramadoId } : {}) };
  });

  // Post-commit (design D2 patrón): programar recordatorios fuera de transacción.
  if (input.accion === 'confirmar') {
    const confirmado = turnos.findById(input.turnoId);
    if (confirmado) programarRecordatoriosSeguro(db, confirmado.id, confirmado.inicio, config.recordatorio);
  } else if (input.accion === 'reprogramar' && resultado.turnoReprogramado) {
    const nuevo = turnos.findById(resultado.turnoReprogramado);
    if (nuevo) programarRecordatoriosSeguro(db, nuevo.id, nuevo.inicio, config.recordatorio);
  }
  return resultado;
}
