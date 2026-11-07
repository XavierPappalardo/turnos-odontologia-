/**
 * Servicio reservaOnline (C-05): crea turnos públicos con origen='online',
 * reutilizando la lógica de solape y bloqueos de C-04. Flujo: validación de
   entrada → FKs → RN-06 anticipación mínima → solape profesional → solape
   sillón → bloqueos → insert dentro de UnitOfWork (BEGIN IMMEDIATE).
 * Errores 400/409 con `eje` e ids opacos sin PHI. No requiere autenticación.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CrearTurnoError } from '../shared/errors.js';
import { UnitOfWork } from '../shared/repository.js';
import type { PacienteId, PrestacionId, ProfesionalId, SillonId, TurnoId } from '../shared/types.js';
import { BloqueoRepository } from './bloqueo.repository.js';
import { TurnoRepository, type TurnoRow } from './turno.repository.js';
import { normalizarUtc } from './crearTurno.service.js';
import { programarRecordatoriosSeguro } from '../notificaciones/recordatorio.worker.js';
import type { RecordatorioConfig } from '../shared/config.js';

export interface ReservaOnlineInput {
  profesionalId: string;
  sillonId: string;
  pacienteId: string;
  prestacionId?: string | undefined;
  inicio: string;
  fin: string;
}

export interface TurnoReservado {
  id: TurnoId;
  profesionalId: ProfesionalId;
  sillonId: SillonId;
  pacienteId: PacienteId;
  inicio: string;
  fin: string;
  estado: 'reservado';
  origen: 'online';
}

function exigirFk(
  db: DatabaseSync,
  tabla: 'profesional' | 'sillon' | 'paciente' | 'prestacion',
  id: string,
  campo: string,
  activoRequerido: boolean,
): void {
  const sql = activoRequerido
    ? `SELECT 1 FROM ${tabla} WHERE id = ? AND activo = 1 LIMIT 1`
    : `SELECT 1 FROM ${tabla} WHERE id = ? LIMIT 1`;
  const stmt = db.prepare(sql);
  if (stmt.get(id) === undefined) {
    throw new CrearTurnoError({
      status: 400,
      code: 'validacion',
      message: `${campo} inexistente`,
    });
  }
}

export function reservarTurnoOnline(
  db: DatabaseSync,
  input: ReservaOnlineInput,
  anticipacionMinSegundos: number,
  recordatorioConfig: RecordatorioConfig,
): TurnoReservado {
  const uow = new UnitOfWork(db);
  const creado = uow.runInTransaction((): TurnoReservado => {
    if (
      input.profesionalId === '' ||
      input.sillonId === '' ||
      input.pacienteId === '' ||
      input.inicio === '' ||
      input.fin === ''
    ) {
      throw new CrearTurnoError({
        status: 400,
        code: 'validacion',
        message: 'campo obligatorio faltante',
      });
    }

    const inicio = normalizarUtc(input.inicio, 'inicio');
    const fin = normalizarUtc(input.fin, 'fin');
    if (fin <= inicio) {
      throw new CrearTurnoError({
        status: 400,
        code: 'validacion',
        message: 'fin debe ser posterior a inicio',
      });
    }

    // FKs existentes y activos (profesional y sillón exigen activo=1).
    exigirFk(db, 'profesional', input.profesionalId, 'profesional_id', true);
    exigirFk(db, 'sillon', input.sillonId, 'sillon_id', true);
    exigirFk(db, 'paciente', input.pacienteId, 'paciente_id', true);
    if (input.prestacionId !== undefined) {
      exigirFk(db, 'prestacion', input.prestacionId, 'prestacion_id', false);
    }

    // RN-06: anticipación mínima configurable. Solo aplica a turnos futuros:
    // una fecha ya pasada no tiene ventana de anticipación que respetar.
    const ahora = new Date();
    const inicioDate = new Date(inicio);
    if (inicioDate >= ahora) {
      const limiteMinimo = new Date(ahora.getTime() + anticipacionMinSegundos * 1000);
      if (inicio < limiteMinimo.toISOString()) {
        throw new CrearTurnoError({
          status: 400,
          code: 'validacion',
          message: `anticipación mínima no respetada (${anticipacionMinSegundos}s)`,
          eje: 'anticipacion',
        });
      }
    }

    const profesionalId = input.profesionalId as ProfesionalId;
    const sillonId = input.sillonId as SillonId;
    const pacienteId = input.pacienteId as PacienteId;

    const turnos = new TurnoRepository(db);
    const bloqueos = new BloqueoRepository(db);

    // Orden de reporte: profesional → sillón → bloqueo → anticipación ya reportada arriba.
    if (turnos.existeSolapeProfesional(profesionalId, inicio, fin)) {
      throw new CrearTurnoError({
        status: 409,
        code: 'conflicto',
        message: 'solape por profesional',
        eje: 'profesional',
        ids: { profesionalId, sillonId, pacienteId },
      });
    }
    if (turnos.existeSolapeSillon(sillonId, inicio, fin)) {
      throw new CrearTurnoError({
        status: 409,
        code: 'conflicto',
        message: 'solape por sillon',
        eje: 'sillon',
        ids: { profesionalId, sillonId, pacienteId },
      });
    }
    if (bloqueos.existeBloqueoAplicable(profesionalId, sillonId, inicio, fin)) {
      throw new CrearTurnoError({
        status: 409,
        code: 'conflicto',
        message: 'bloqueo aplicable',
        eje: 'bloqueo',
        ids: { profesionalId, sillonId, pacienteId },
      });
    }

    const id = randomUUID() as TurnoId;
    turnos.crear({
      id,
      profesionalId,
      sillonId,
      pacienteId,
      prestacionId: input.prestacionId as PrestacionId | undefined,
      inicio,
      fin,
      estado: 'reservado',
      origen: 'online',
    });

    // Log operativo sin PHI (R3): solo UUID opaco.
    // eslint-disable-next-line no-console
    console.log(`turno online creado id=${id}`);

    const row = turnos.findById(id) as TurnoRow;
    return {
      id,
      profesionalId,
      sillonId,
      pacienteId,
      inicio: row.inicio,
      fin: row.fin,
      estado: 'reservado',
      origen: 'online',
    };
  });

  // Programación post-commit (design D1/D2): fuera del BEGIN IMMEDIATE.
  programarRecordatoriosSeguro(db, creado.id, creado.inicio, recordatorioConfig);
  return creado;
}
