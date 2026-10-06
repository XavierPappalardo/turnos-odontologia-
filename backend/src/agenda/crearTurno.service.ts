/**
 * Servicio crearTurno (design D3): flujo BEGIN IMMEDIATE → validar entrada
 * → RBAC → intersección profesional → sillón → bloqueos → insert
 * `reservado` → commit. Errores 400/403/409 con `eje` e ids opacos sin PHI.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { puedeCrearTurno, type Rol } from '../shared/auth.js';
import { CrearTurnoError } from '../shared/errors.js';
import { UnitOfWork } from '../shared/repository.js';
import type {
  PacienteId,
  PrestacionId,
  ProfesionalId,
  SillonId,
  TurnoId,
} from '../shared/types.js';
import { BloqueoRepository } from './bloqueo.repository.js';
import { TurnoRepository, type TurnoRow } from './turno.repository.js';

export interface CrearTurnoInput {
  profesionalId: string;
  sillonId: string;
  pacienteId: string;
  prestacionId?: string | undefined;
  inicio: string;
  fin: string;
  rol: Rol | undefined;
}

export interface TurnoCreado {
  id: TurnoId;
  profesionalId: ProfesionalId;
  sillonId: SillonId;
  pacienteId: PacienteId;
  inicio: string;
  fin: string;
  estado: 'reservado';
  origen: 'recepcion';
}

/** Normaliza a ISO 8601 UTC de ancho fijo; rechaza formatos ambiguos (400). */
export function normalizarUtc(valor: string, campo: string): string {
  const ms = Date.parse(valor);
  if (Number.isNaN(ms)) {
    throw new CrearTurnoError({
      status: 400,
      code: 'validacion',
      message: `formato de fecha no UTC en ${campo}`,
    });
  }
  const d = new Date(ms);
  const iso = d.toISOString();
  // Exigir entrada con zona horaria explícita (Z o ±hh:mm) para evitar
  // comparaciones lexicográficas ambiguas (design D2 trade-off).
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(valor.trim())) {
    throw new CrearTurnoError({
      status: 400,
      code: 'validacion',
      message: `formato de fecha no UTC en ${campo}`,
    });
  }
  return iso;
}

function exigirFk(
  db: DatabaseSync,
  tabla: 'profesional' | 'sillon' | 'paciente' | 'prestacion',
  id: string,
  campo: string,
): void {
  // `profesional`/`sillon` exigen activo=1; `paciente`/`prestacion` solo existencia.
  const sql =
    tabla === 'profesional' || tabla === 'sillon'
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

export function crearTurno(db: DatabaseSync, input: CrearTurnoInput): TurnoCreado {
  const uow = new UnitOfWork(db);
  return uow.runInTransaction(() => {
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

    exigirFk(db, 'profesional', input.profesionalId, 'profesional_id');
    exigirFk(db, 'sillon', input.sillonId, 'sillon_id');
    exigirFk(db, 'paciente', input.pacienteId, 'paciente_id');
    if (input.prestacionId !== undefined) {
      exigirFk(db, 'prestacion', input.prestacionId, 'prestacion_id');
    }

    if (!puedeCrearTurno(input.rol)) {
      throw new CrearTurnoError({
        status: 403,
        code: 'forbidden',
        message: 'rol sin permiso de creacion de turnos',
      });
    }

    const profesionalId = input.profesionalId as ProfesionalId;
    const sillonId = input.sillonId as SillonId;
    const pacienteId = input.pacienteId as PacienteId;

    const turnos = new TurnoRepository(db);
    const bloqueos = new BloqueoRepository(db);

    // Orden de reporte: profesional → sillón → bloqueo (design D2).
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
      origen: 'recepcion',
    });

    // Log operativo sin PHI (R3): solo UUID opaco.
    // eslint-disable-next-line no-console
    console.log(`turno creado id=${id}`);

    const row = turnos.findById(id) as TurnoRow;
    return {
      id,
      profesionalId,
      sillonId,
      pacienteId,
      inicio: row.inicio,
      fin: row.fin,
      estado: 'reservado',
      origen: 'recepcion',
    };
  });
}
