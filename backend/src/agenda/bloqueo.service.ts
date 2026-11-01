/**
 * Servicio CRUD de bloqueos de agenda (C-08, design D5).
 * Escrituras completas dentro de `UnitOfWork.runInTransaction` (`BEGIN
 * IMMEDIATE`, R9): la intersección con turnos activos y la escritura son
 * atómicas frente a un `crearTurno` concurrente.
 * Errores 400/403/404/409 con `BloqueoError` y solo ids opacos (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { puedeGestionarBloqueos, type Rol } from '../shared/auth.js';
import { BloqueoError, CrearTurnoError } from '../shared/errors.js';
import { UnitOfWork } from '../shared/repository.js';
import type {
  BloqueoId,
  ProfesionalId,
  SillonId,
  TurnoId,
} from '../shared/types.js';
import {
  BloqueoRepository,
  type BloqueoEditable,
  type BloqueoRow,
  type FiltroBloqueos,
} from './bloqueo.repository.js';
import { normalizarUtc } from './crearTurno.service.js';

export interface CrearBloqueoInput {
  profesionalId: string | null;
  sillonId: string | null;
  inicio: string;
  fin: string;
  motivo?: string | null | undefined;
  rol: Rol | undefined;
}

export interface BloqueoCreado {
  id: BloqueoId;
  profesionalId: ProfesionalId | null;
  sillonId: SillonId | null;
  inicio: string;
  fin: string;
  motivo: string | null;
}

export interface ListarBloqueosInput {
  profesionalId?: string | undefined;
  sillonId?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
}

export interface ActualizarBloqueoInput {
  id: string;
  profesionalId?: string | null | undefined;
  sillonId?: string | null | undefined;
  inicio?: string | undefined;
  fin?: string | undefined;
  motivo?: string | null | undefined;
  rol: Rol | undefined;
}

export interface EliminarBloqueoInput {
  id: string;
  rol: Rol | undefined;
}

/** Reutiliza la semántica ISO/UTC de C-04 y la traduce al error de bloqueos. */
function normalizarFecha(valor: string, campo: string): string {
  try {
    return normalizarUtc(valor, campo);
  } catch (err) {
    if (err instanceof CrearTurnoError) {
      throw new BloqueoError({
        status: 400,
        code: 'validacion',
        message: err.message,
      });
    }
    throw err;
  }
}

/** FK activa (design D4): el SQL vive en el repositorio (R8). */
function exigirFkActiva(
  db: DatabaseSync,
  tabla: 'profesional' | 'sillon',
  id: string,
  campo: string,
): void {
  if (!new BloqueoRepository(db).existeFkActiva(tabla, id)) {
    throw new BloqueoError({
      status: 400,
      code: 'validacion',
      message: `${campo} inexistente o inactivo`,
    });
  }
}

/** Un bloqueo global (NULL) no exige FK; un valor explícito sí. */
function exigirFkOpcional(
  db: DatabaseSync,
  tabla: 'profesional' | 'sillon',
  id: string | null,
  campo: string,
): void {
  if (id === null) return;
  exigirFkActiva(db, tabla, id, campo);
}

/** Defensa en profundidad: la ruta ya aplica `requireRoles` (design D6). */
function exigirGestion(rol: Rol | undefined): void {
  if (!puedeGestionarBloqueos(rol)) {
    throw new BloqueoError({
      status: 403,
      code: 'forbidden',
      message: 'rol sin permiso de gestion de bloqueos',
    });
  }
}

function rechazarInterseccion(turnoIds: readonly TurnoId[]): void {
  if (turnoIds.length === 0) return;
  throw new BloqueoError({
    status: 409,
    code: 'conflicto',
    message: 'bloqueo intersecta turnos activos',
    eje: 'bloqueo',
    turnoIds,
  });
}

export function crearBloqueo(
  db: DatabaseSync,
  input: CrearBloqueoInput,
): BloqueoCreado {
  const uow = new UnitOfWork(db);
  return uow.runInTransaction(() => {
    if (input.inicio === '' || input.fin === '') {
      throw new BloqueoError({
        status: 400,
        code: 'validacion',
        message: 'campo obligatorio faltante',
      });
    }

    const inicio = normalizarFecha(input.inicio, 'inicio');
    const fin = normalizarFecha(input.fin, 'fin');
    if (fin <= inicio) {
      throw new BloqueoError({
        status: 400,
        code: 'validacion',
        message: 'fin debe ser posterior a inicio',
      });
    }

    exigirFkOpcional(db, 'profesional', input.profesionalId, 'profesional_id');
    exigirFkOpcional(db, 'sillon', input.sillonId, 'sillon_id');
    exigirGestion(input.rol);

    const repo = new BloqueoRepository(db);
    rechazarInterseccion(
      repo.turnosActivosEnInterseccion(
        input.profesionalId,
        input.sillonId,
        inicio,
        fin,
      ),
    );

    const id = randomUUID() as BloqueoId;
    const motivo = input.motivo ?? null;
    repo.crear({
      id,
      profesionalId: input.profesionalId as ProfesionalId | null,
      sillonId: input.sillonId as SillonId | null,
      inicio,
      fin,
      motivo,
    });

    // Log operativo sin PHI (R3): solo el UUID opaco del bloqueo.
    // eslint-disable-next-line no-console
    console.log(`bloqueo creado id=${id}`);

    return {
      id,
      profesionalId: input.profesionalId as ProfesionalId | null,
      sillonId: input.sillonId as SillonId | null,
      inicio,
      fin,
      motivo,
    };
  });
}

/** Lectura pura (design D5): sin lógica por rol ni escritura. */
export function listarBloqueos(
  db: DatabaseSync,
  input: ListarBloqueosInput,
): BloqueoRow[] {
  const filtros: FiltroBloqueos = {};
  if (input.profesionalId !== undefined) {
    filtros.profesionalId = input.profesionalId;
  }
  if (input.sillonId !== undefined) filtros.sillonId = input.sillonId;
  if (input.desde !== undefined) filtros.desde = input.desde;
  if (input.hasta !== undefined) filtros.hasta = input.hasta;
  return new BloqueoRepository(db).listar(filtros);
}

export function actualizarBloqueo(
  db: DatabaseSync,
  input: ActualizarBloqueoInput,
): BloqueoRow {
  const uow = new UnitOfWork(db);
  return uow.runInTransaction(() => {
    const repo = new BloqueoRepository(db);
    const id = input.id as BloqueoId;
    const actual = repo.buscarVigente(id);
    if (actual === undefined) {
      throw new BloqueoError({
        status: 404,
        code: 'not_found',
        message: 'bloqueo inexistente',
      });
    }

    const inicio = normalizarFecha(input.inicio ?? actual.inicio, 'inicio');
    const fin = normalizarFecha(input.fin ?? actual.fin, 'fin');
    if (fin <= inicio) {
      throw new BloqueoError({
        status: 400,
        code: 'validacion',
        message: 'fin debe ser posterior a inicio',
      });
    }

    const profesionalId =
      input.profesionalId === undefined
        ? actual.profesional_id
        : input.profesionalId;
    const sillonId =
      input.sillonId === undefined ? actual.sillon_id : input.sillonId;

    exigirFkOpcional(db, 'profesional', profesionalId, 'profesional_id');
    exigirFkOpcional(db, 'sillon', sillonId, 'sillon_id');
    exigirGestion(input.rol);

    rechazarInterseccion(
      repo.turnosActivosEnInterseccion(
        profesionalId,
        sillonId,
        inicio,
        fin,
      ),
    );

    const patch: BloqueoEditable = {};
    if (input.profesionalId !== undefined) {
      patch.profesional_id = profesionalId;
    }
    if (input.sillonId !== undefined) patch.sillon_id = sillonId;
    if (input.inicio !== undefined) patch.inicio = inicio;
    if (input.fin !== undefined) patch.fin = fin;
    if (input.motivo !== undefined) patch.motivo = input.motivo;
    repo.actualizar(id, patch);

    const actualizado = repo.buscarVigente(id);
    if (actualizado === undefined) {
      throw new BloqueoError({
        status: 404,
        code: 'not_found',
        message: 'bloqueo inexistente',
      });
    }

    // Log operativo sin PHI (R3): solo el UUID opaco del bloqueo.
    // eslint-disable-next-line no-console
    console.log(`bloqueo actualizado id=${id}`);
    return actualizado;
  });
}

export function eliminarBloqueo(
  db: DatabaseSync,
  input: EliminarBloqueoInput,
): void {
  const uow = new UnitOfWork(db);
  uow.runInTransaction(() => {
    const repo = new BloqueoRepository(db);
    const id = input.id as BloqueoId;
    if (repo.buscarVigente(id) === undefined) {
      throw new BloqueoError({
        status: 404,
        code: 'not_found',
        message: 'bloqueo inexistente',
      });
    }
    exigirGestion(input.rol);
    repo.bajaLogica(id);

    // Log operativo sin PHI (R3): solo el UUID opaco del bloqueo.
    // eslint-disable-next-line no-console
    console.log(`bloqueo eliminado id=${id}`);
  });
}
