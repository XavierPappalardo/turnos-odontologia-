/**
 * Helpers de seed para los tests de reportes (C-14).
 *
 * - SQLite REAL en memoria con todas las migraciones aplicadas (R12): los
 *   tests abren la base con `openDatabase(':memory:')`, nunca mockean.
 * - Datos estrictamente ficticios (R1/R12): ids literales legibles y nombres
 *   genéricos, sin PHI real.
 * - Las altas de turnos usan `TurnoRepository.crear` (R8: ningún INSERT suelto
 *   en tests con semántica de dominio); pagos y movimientos usan los
 *   repositorios de caja existentes.
 */
import type { DatabaseSync } from 'node:sqlite';
import { TurnoRepository } from '../../src/agenda/turno.repository.js';
import { PagoRepository } from '../../src/core/pago.repository.js';
import { CajaMovimientoRepository } from '../../src/caja/cajaMovimiento.repository.js';
import type { MotivoAsignacionCaja } from '../../src/shared/types.js';
import type {
  PacienteId,
  PrestacionId,
  ProfesionalId,
  SillonId,
  TurnoEstado,
  TurnoId,
} from '../../src/shared/types.js';
import type { PagoMedio } from '../../src/core/models.js';

/** Zona horaria de los escenarios (default documentado de caja, design D11). */
export const ZONA_TEST = 'America/Buenos_Aires';

export interface ReportesSeed {
  readonly usuarioId: string;
  readonly profesionalId: string;
  readonly sillonId: string;
  readonly pacienteId: string;
  readonly prestacionId: string;
  /** Turno señuelo en el año 2000, fuera de cualquier rango de reporte probado. */
  readonly turnoBaseId: string;
}

function ahora(): string {
  return new Date().toISOString();
}

/** Profesional ficticio con id legible. */
export function insertarProfesional(
  db: DatabaseSync,
  id: string,
  matricula: string,
): void {
  const sello = ahora();
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES (?, 'Profesional Ficticio', ?, 'Odontología', 1, ?, ?)`,
  ).run(id, matricula, sello, sello);
}

/** Sillón ficticio con id legible (`nombre` es UNIQUE → se deriva del id). */
export function insertarSillon(db: DatabaseSync, id: string): void {
  const sello = ahora();
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(id, `Sillón ${id}`, sello, sello);
}

/** Paciente ficticio (sin datos personales reales, R1). */
export function insertarPaciente(db: DatabaseSync, id: string): void {
  const sello = ahora();
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
     VALUES (?, 'Paciente Ficticio', NULL, NULL, 1, ?, ?)`,
  ).run(id, sello, sello);
}

/** Prestación ficticia. */
export function insertarPrestacion(
  db: DatabaseSync,
  id: string,
  duracionMin = 30,
): void {
  const sello = ahora();
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, activo, created_at, updated_at)
     VALUES (?, ?, 'Consulta Ficticia', ?, 1, ?, ?)`,
  ).run(id, `COD-${id}`, duracionMin, sello, sello);
}

/** Usuario ficticio sin vínculo profesional (actor de caja). */
export function insertarUsuario(db: DatabaseSync, id: string): void {
  const sello = ahora();
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
     VALUES (?, ?, 'hash', 1, NULL, ?, ?)`,
  ).run(id, `${id}@ficticio.test`, sello, sello);
}

/**
 * Semilla base mínima para todos los escenarios de reportes: un profesional,
 * un sillón, un paciente, una prestación, un usuario actor y un turno señuelo
 * fuera de rango (para que `pago.turno_id` tenga FK válida).
 */
export function seedReportesBase(
  db: DatabaseSync,
  opciones?: { profesionalId?: string; sillonId?: string },
): ReportesSeed {
  const profesionalId = opciones?.profesionalId ?? 'prof-a';
  const sillonId = opciones?.sillonId ?? 'sillon-a';
  const usuarioId = 'user-reportes';
  const pacienteId = 'pac-ficticio';
  const prestacionId = 'pres-ficticia';
  insertarProfesional(db, profesionalId, `MN-${profesionalId}`);
  insertarSillon(db, sillonId);
  insertarPaciente(db, pacienteId);
  insertarPrestacion(db, prestacionId);
  insertarUsuario(db, usuarioId);
  sembrarTurno(db, {
    id: 'turno-base',
    inicio: '2000-01-01T10:00:00.000Z',
    fin: '2000-01-01T10:30:00.000Z',
    estado: 'atendido',
    profesionalId,
    sillonId,
    pacienteId,
  });
  return {
    usuarioId,
    profesionalId,
    sillonId,
    pacienteId,
    prestacionId,
    turnoBaseId: 'turno-base',
  };
}

export interface TurnoSeed {
  readonly id: string;
  /** Instante ISO-8601 UTC. */
  readonly inicio: string;
  /** Instante ISO-8601 UTC. */
  readonly fin: string;
  readonly estado?: TurnoEstado;
  readonly profesionalId?: string;
  readonly sillonId?: string;
  readonly pacienteId?: string;
}

/**
 * Alta de turno vía `TurnoRepository.crear`. Los ids se castean dentro del
 * helper: los escenarios son ficticios y no necesitan brand types en el call
 * site (R10 se respeta en `src/`).
 */
export function sembrarTurno(db: DatabaseSync, args: TurnoSeed): void {
  new TurnoRepository(db).crear({
    id: args.id as TurnoId,
    profesionalId: (args.profesionalId ?? 'prof-a') as ProfesionalId,
    sillonId: (args.sillonId ?? 'sillon-a') as SillonId,
    pacienteId: (args.pacienteId ?? 'pac-ficticio') as PacienteId,
    prestacionId: 'pres-ficticia' as PrestacionId,
    inicio: args.inicio,
    fin: args.fin,
    estado: args.estado ?? 'confirmado',
    origen: 'recepcion',
  });
}

export interface PagoSeed {
  readonly id: string;
  readonly montoCentavos: number;
  readonly medio: PagoMedio;
  readonly estado?: 'pendiente' | 'cobrado' | 'anulado';
  readonly turnoId?: string;
}

/** Alta de pago vía `PagoRepository.cobrar` (aplicado al turno dado). */
export function sembrarPago(db: DatabaseSync, args: PagoSeed): void {
  new PagoRepository(db).cobrar({
    id: args.id,
    montoCentavos: args.montoCentavos,
    medio: args.medio,
    estado: args.estado ?? 'cobrado',
    turnoId: args.turnoId ?? 'turno-base',
    presupuestoId: null,
    actorUsuarioId: 'user-reportes',
  });
}

export interface MovimientoSeed {
  readonly id: string;
  readonly pagoId: string;
  readonly tipo: 'cobro' | 'anulacion';
  readonly montoCentavos: number;
  readonly fechaContable: string;
  readonly aplicadoEn?: string | undefined;
  readonly motivoAsignacion?: MotivoAsignacionCaja | undefined;
}

/** Alta de movimiento de caja append-only vía repositorio. */
export function sembrarMovimiento(
  db: DatabaseSync,
  args: MovimientoSeed,
): void {
  new CajaMovimientoRepository(db).insertar({
    id: args.id as never,
    pagoId: args.pagoId as never,
    tipo: args.tipo,
    montoCentavos: args.montoCentavos,
    actorUsuarioId: 'user-reportes',
    fechaContable: args.fechaContable,
    aplicadoEn: args.aplicadoEn,
    motivoAsignacion: args.motivoAsignacion,
  });
}
