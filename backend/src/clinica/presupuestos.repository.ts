/**
 * Task 3.1/3.2: PresupuestoRepository + ItemPresupuestoRepository (C-10).
 * Extienden BaseRepository[T] con UnitOfWork + AuditMixin (R8).
 * Todo el SQL vive aquí; servicio y rutas nunca emiten SQL suelto.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository, UnitOfWork } from '../shared/repository.js';
import type {
  Presupuesto,
  ItemPresupuesto,
  PresupuestoId,
  ItemPresupuestoId,
} from '../shared/types.js';

export interface PresupuestoRow {
  readonly id: string;
  readonly paciente_id: string;
  readonly turno_id: string | null;
  readonly estado: string;
  readonly total_centavos: number;
  readonly cobertura_centavos: number;
  readonly saldo_centavos: number;
  readonly obra_social_plan_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface ItemPresupuestoRow {
  readonly id: string;
  readonly presupuesto_id: string;
  readonly descripcion: string;
  readonly monto_centavos: number;
  readonly pieza_fdi: number | null;
  readonly superficie: string | null;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly deleted_at: string | null;
}

export interface PresupuestoInput {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  estado: string;
  total_centavos: number;
  cobertura_centavos: number;
  saldo_centavos: number;
  obra_social_plan_id: string | null;
}

export interface ItemPresupuestoInput {
  id: string;
  presupuesto_id: string;
  descripcion: string;
  monto_centavos: number;
  pieza_fdi: number | null;
  superficie: string | null;
}

/**
 * Repositorio de presupuestos. Operaciones: insert, findById, listar activos,
 * update (solo borrador vía servicio), softDelete.
 */
export class PresupuestoRepository extends BaseRepository<PresupuestoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'presupuesto');
  }

  insertar(input: PresupuestoInput): void {
    this.insert({
      id: input.id,
      paciente_id: input.paciente_id,
      turno_id: input.turno_id,
      estado: input.estado,
      total_centavos: input.total_centavos,
      cobertura_centavos: input.cobertura_centavos,
      saldo_centavos: input.saldo_centavos,
      obra_social_plan_id: input.obra_social_plan_id,
    } as unknown as Omit<PresupuestoRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }

  findById(id: string): PresupuestoRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM presupuesto WHERE id = ? AND deleted_at IS NULL`,
    );
    return stmt.get(id) as PresupuestoRow | undefined;
  }

  listarActivos(): PresupuestoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM presupuesto WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return stmt.all() as unknown as PresupuestoRow[];
  }

  listarPorPaciente(pacienteId: string): PresupuestoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM presupuesto
       WHERE paciente_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    );
    return stmt.all(pacienteId) as unknown as PresupuestoRow[];
  }

  /** Conceptos por turno (C-11): para application de cobros y deuda del turno. */
  listarPorTurno(turnoId: string): PresupuestoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM presupuesto
       WHERE turno_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    );
    return stmt.all(turnoId) as unknown as PresupuestoRow[];
  }

  /** Conceptos aceptados vigentes del paciente (C-11, deuda por paciente). */
  listarAceptadosPorPaciente(pacienteId: string): PresupuestoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM presupuesto
       WHERE paciente_id = ? AND estado = 'aceptado' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    );
    return stmt.all(pacienteId) as unknown as PresupuestoRow[];
  }

  updateEstado(id: string, estado: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE presupuesto
          SET estado = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(estado, new Date().toISOString(), id);
    return result.changes === 1;
  }

  updateTotales(
    id: string,
    total: number,
    cobertura: number,
    saldo: number,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE presupuesto
          SET total_centavos = ?, cobertura_centavos = ?, saldo_centavos = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        total,
        cobertura,
        saldo,
        new Date().toISOString(),
        id,
      ) as { changes: number };
    return result.changes === 1;
  }
}

/**
 * Repositorio de ítems de presupuesto.
 * Operaciones: insert, findByPresupuesto, listar activos.
 */
export class ItemPresupuestoRepository extends BaseRepository<ItemPresupuestoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'item_presupuesto');
  }

  insertar(input: ItemPresupuestoInput): void {
    this.insert({
      id: input.id,
      presupuesto_id: input.presupuesto_id,
      descripcion: input.descripcion,
      monto_centavos: input.monto_centavos,
      pieza_fdi: input.pieza_fdi,
      superficie: input.superficie,
    } as unknown as Omit<ItemPresupuestoRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }

  findByPresupuesto(presupuestoId: string): ItemPresupuestoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM item_presupuesto
       WHERE presupuesto_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    );
    return stmt.all(presupuestoId) as unknown as ItemPresupuestoRow[];
  }

  softDeleteItemsPresupuesto(presupuestoId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE item_presupuesto
          SET deleted_at = ?, updated_at = ?
        WHERE presupuesto_id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, presupuestoId);
  }
}

export { UnitOfWork };
