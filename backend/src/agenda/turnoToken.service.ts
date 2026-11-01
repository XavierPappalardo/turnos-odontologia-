/**
 * Servicio turnoToken (C-06): confirma, cancela y reprograma turnos mediante
 * tokens de acción de un solo uso. Reutiliza la máquina de estados de C-04,
 * la lógica de solape/bloqueos y UnitOfWork (BEGIN IMMEDIATE).
 * Errores 400/401/403/404/409 con `eje` e ids opacos sin PHI. No requiere JWT.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashToken } from '../auth/tokens.js';
import { CrearTurnoError, AuthError, TurnoEstadoError } from '../shared/errors.js';
import { UnitOfWork } from '../shared/repository.js';
import type { AppConfig } from '../shared/config.js';
import type { PacienteId, PrestacionId, ProfesionalId, SillonId, TurnoEstado, TurnoId, TurnoOrigen } from '../shared/types.js';
import { BloqueoRepository } from './bloqueo.repository.js';
import { TurnoRepository, type TurnoRow } from './turno.repository.js';
import { puedeTransicionar } from './turnoEstado.service.js';
import { cancelarRecordatoriosDeTurno } from '../notificaciones/recordatorio.worker.js';
import { normalizarUtc } from './crearTurno.service.js';

export type AccionTurno = 'confirmar' | 'cancelar' | 'reprogramar';

export interface AccionTurnoInput {
  turnoId: string;
  accion: AccionTurno;
  token: string;
  nuevoInicio?: string;
  nuevoFin?: string;
}

export interface TurnoActualizado {
  id: TurnoId;
  estado: TurnoEstado;
  origen: TurnoOrigen;
  turnoReprogramado?: TurnoId;
}

function exigeFkActivo(
  db: DatabaseSync,
  tabla: 'profesional' | 'sillon' | 'paciente' | 'prestacion',
  id: string,
  campo: string,
): void {
  const sql = `SELECT 1 FROM ${tabla} WHERE id = ? AND activo = 1 LIMIT 1`;
  const stmt = db.prepare(sql);
  if (stmt.get(id) === undefined) {
    throw new CrearTurnoError({
      status: 400,
      code: 'validacion',
      message: `${campo} inexistente`,
    });
  }
}

export function ejecutarAccionTurno(
  db: DatabaseSync,
  input: AccionTurnoInput,
  config: AppConfig,
): TurnoActualizado {
  const uow = new UnitOfWork(db);
  return uow.runInTransaction(() => {
    const tokenHash = hashToken(input.token);
    const ahora = new Date();
    const ahoraIso = ahora.toISOString();

    // 1. Buscar token por hash.
    const tokenRow = db
      .prepare(
        `SELECT id, turno_id, accion, expires_at, usado_en FROM turno_token WHERE token_hash = ?`,
      )
      .get(tokenHash) as {
        id: string;
        turno_id: string;
        accion: string;
        expires_at: string;
        usado_en: string | null;
      } | undefined;

    if (tokenRow === undefined) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'token inválido',
      });
    }

    // 2. Validar expiración.
    if (tokenRow.expires_at < ahoraIso) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'token expirado',
      });
    }

    // 3. Validar uso único.
    if (tokenRow.usado_en !== null) {
      throw new TurnoEstadoError({
        status: 403,
        code: 'forbidden',
        message: 'token ya usado',
      });
    }

    // 4. Validar que el token pertenezca al turno y a la acción solicitada.
    if (tokenRow.turno_id !== input.turnoId) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'token no pertenece a este turno',
      });
    }
    if (tokenRow.accion !== input.accion) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'token no corresponde a esta acción',
      });
    }

    // 5. Validar existencia del turno.
    const turnos = new TurnoRepository(db);
    const turnoActual = turnos.findById(input.turnoId) as TurnoRow | undefined;
    if (turnoActual === undefined) {
      throw new TurnoEstadoError({
        status: 404,
        code: 'not_found',
        message: 'turno inexistente',
      });
    }

    // 6. Validar transición de estado según máquina de estados C-04.
    let nuevoEstado: TurnoEstado;
    switch (input.accion) {
      case 'confirmar':
        nuevoEstado = 'confirmado';
        break;
      case 'cancelar':
        nuevoEstado = 'cancelado';
        break;
      case 'reprogramar':
        nuevoEstado = 'cancelado';
        break;
      default:
        throw new TurnoEstadoError({
          status: 400,
          code: 'validacion',
          message: 'acción inválida',
        });
    }

    if (!puedeTransicionar(turnoActual.estado, nuevoEstado)) {
      throw new TurnoEstadoError({
        status: 409,
        code: 'transicion_invalida',
        message: 'transición de estado inválida',
        desde: turnoActual.estado,
        hacia: nuevoEstado,
      });
    }

    // 7. Validaciones específicas por acción.
    if (input.accion === 'cancelar') {
      // RN-06: anticipación mínima para cancelación.
      const inicioTurno = new Date(turnoActual.inicio);
      const diferenciaSegundos = (
        inicioTurno.getTime() - ahora.getTime()
      ) / 1000;
      if (diferenciaSegundos < config.reservaOnline.anticipacionMinSegundos) {
        throw new CrearTurnoError({
          status: 400,
          code: 'validacion',
          message: 'anticipación mínima no respetada para cancelación',
          eje: 'anticipacion',
        });
      }
    }

    let turnoReprogramadoId: TurnoId | undefined;

    if (input.accion === 'reprogramar') {
      if (input.nuevoInicio === undefined || input.nuevoFin === undefined) {
        throw new CrearTurnoError({
          status: 400,
          code: 'validacion',
          message: 'reprogramar requiere nuevo_inicio y nuevo_fin',
        });
      }
      const nuevoInicio = normalizarUtc(input.nuevoInicio, 'nuevo_inicio');
      const nuevoFin = normalizarUtc(input.nuevoFin, 'nuevo_fin');
      if (nuevoFin <= nuevoInicio) {
        throw new CrearTurnoError({
          status: 400,
          code: 'validacion',
          message: 'fin debe ser posterior a inicio',
        });
      }

      // Validar FKs del nuevo turno.
      exigeFkActivo(db, 'profesional', turnoActual.profesional_id, 'profesional_id');
      exigeFkActivo(db, 'sillon', turnoActual.sillon_id, 'sillon_id');
      exigeFkActivo(db, 'paciente', turnoActual.paciente_id, 'paciente_id');
      if (turnoActual.prestacion_id !== null) {
        db.prepare(
          `SELECT 1 FROM prestacion WHERE id = ? LIMIT 1`,
        ).get(turnoActual.prestacion_id);
      }

      const bloqueos = new BloqueoRepository(db);
      const profesionalId = turnoActual.profesional_id as ProfesionalId;
      const sillonId = turnoActual.sillon_id as SillonId;

      // Validar solape del nuevo turno.
      if (turnos.existeSolapeProfesional(profesionalId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({
          status: 409,
          code: 'conflicto',
          message: 'solape por profesional',
          eje: 'profesional',
          ids: {
            profesionalId,
            sillonId,
            pacienteId: turnoActual.paciente_id as PacienteId,
          },
        });
      }
      if (turnos.existeSolapeSillon(sillonId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({
          status: 409,
          code: 'conflicto',
          message: 'solape por sillon',
          eje: 'sillon',
          ids: {
            profesionalId,
            sillonId,
            pacienteId: turnoActual.paciente_id as PacienteId,
          },
        });
      }
      if (bloqueos.existeBloqueoAplicable(profesionalId, sillonId, nuevoInicio, nuevoFin)) {
        throw new CrearTurnoError({
          status: 409,
          code: 'conflicto',
          message: 'bloqueo aplicable',
          eje: 'bloqueo',
          ids: {
            profesionalId,
            sillonId,
            pacienteId: turnoActual.paciente_id as PacienteId,
          },
        });
      }
    }

    // 8. Marcar token como usado (uso único).
    db.prepare(
      `UPDATE turno_token SET usado_en = ?, updated_at = ? WHERE id = ?`,
    ).run(ahoraIso, ahoraIso, tokenRow.id);

    // 9. Ejecutar transición de estado (CAS).
    const actualizado = turnos.actualizarEstado(
      input.turnoId as TurnoId,
      turnoActual.estado,
      nuevoEstado,
    );
    if (!actualizado) {
      throw new TurnoEstadoError({
        status: 409,
        code: 'transicion_invalida',
        message: 'el turno cambió de estado concurrentemente',
        desde: turnoActual.estado,
        hacia: nuevoEstado,
      });
    }

    // Cancelar recordatorios pendientes al cancelar o reprogramar el turno.
    if (input.accion === 'cancelar' || input.accion === 'reprogramar') {
      cancelarRecordatoriosDeTurno(db, input.turnoId);
    }

    // 10. Si es reprogramar, crear turno nuevo con origen 'online'.
    if (input.accion === 'reprogramar') {
      const nuevoId = randomUUID() as TurnoId;
      turnos.crear({
        id: nuevoId,
        profesionalId: turnoActual.profesional_id as ProfesionalId,
        sillonId: turnoActual.sillon_id as SillonId,
        pacienteId: turnoActual.paciente_id as PacienteId,
        prestacionId: turnoActual.prestacion_id as PrestacionId | undefined,
        inicio: normalizarUtc(input.nuevoInicio!, 'nuevo_inicio'),
        fin: normalizarUtc(input.nuevoFin!, 'nuevo_fin'),
        estado: 'reservado',
        origen: 'online',
      });
      turnoReprogramadoId = nuevoId;
    }

    // Log operativo sin PHI (R3): solo UUID opaco.
    // eslint-disable-next-line no-console
    console.log(`turno ${input.accion} id=${input.turnoId} token consumido`);

    const fila = turnos.findById(input.turnoId) as TurnoRow;
    return {
      id: input.turnoId as TurnoId,
      estado: fila.estado,
      origen: fila.origen,
      ...(turnoReprogramadoId !== undefined
        ? { turnoReprogramado: turnoReprogramadoId }
        : {}),
    };
  });
}
