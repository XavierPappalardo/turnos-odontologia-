/**
 * Task 4.x: PresupuestoService (C-10).
 * Reglas de negocio: creación, autocalculo cobertura/saldo, máquina de estados,
 * edición solo en borrador, ítems con monto centavos y vínculo opcional a odontograma.
 * Todo acceso a datos vía repositorios + UnitOfWork (R8). Errores sin PHI (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import type {
  Presupuesto,
  ItemPresupuesto,
  PresupuestoId,
  ItemPresupuestoId,
  PacienteId,
  TurnoId,
  ObraSocialPlanId,
  PresupuestoEstado,
} from '../shared/types.js';
import { PRESUPUESTO_TRANSICIONES } from '../shared/types.js';
import { AppError } from '../shared/errors.js';
import {
  PresupuestoRepository,
  ItemPresupuestoRepository,
  type PresupuestoInput,
  type ItemPresupuestoInput,
} from './presupuestos.repository.js';
import { UnitOfWork } from '../shared/repository.js';
import { AccesoHcService } from './accesoHc.service.js';

const ESTADO_INICIAL: PresupuestoEstado = 'borrador';

function esTransicionValida(
  desde: PresupuestoEstado,
  hacia: PresupuestoEstado,
): boolean {
  const permitidos = PRESUPUESTO_TRANSICIONES.get(desde);
  return permitidos !== undefined && permitidos.includes(hacia);
}

export interface CrearPresupuestoInput {
  pacienteId: PacienteId;
  turnoId: TurnoId | null;
  total_centavos?: number | undefined;
}

export interface EditarPresupuestoInput {
  total_centavos?: number | undefined;
  obra_social_plan_id?: ObraSocialPlanId | null | undefined;
}

export interface AgregarItemInput {
  descripcion: string;
  monto_centavos: number;
  pieza_fdi: number | null;
  superficie: string | null;
}

export interface EditarItemInput {
  descripcion?: string | undefined;
  monto_centavos?: number | undefined;
  pieza_fdi?: number | null | undefined;
  superficie?: string | null | undefined;
}

export interface PresupuestoConItems extends Presupuesto {
  items: ItemPresupuesto[];
}

export class PresupuestoService {
  private readonly repo: PresupuestoRepository;
  private readonly itemRepo: ItemPresupuestoRepository;
  private readonly uow: UnitOfWork;
  private readonly accesoHc: AccesoHcService;
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.repo = new PresupuestoRepository(db);
    this.itemRepo = new ItemPresupuestoRepository(db);
    this.uow = new UnitOfWork(db);
    this.accesoHc = new AccesoHcService(db);
    this.db = db;
  }

  // ── 4.1 Creación ──
  crearPresupuesto(input: CrearPresupuestoInput): PresupuestoConItems {
    this.validarTurnoPerteneceAPaciente(input.pacienteId, input.turnoId);

    const id = crypto.randomUUID() as PresupuestoId;
    const coberturaPct = this.obtenerCoberturaPctPaciente(input.pacienteId);
    const total = input.total_centavos ?? 0;
    const cobertura = this.calcularCobertura(total, coberturaPct);
    const saldo = total - cobertura;
    const planId = this.obtenerPlanIdPaciente(input.pacienteId);

    const presupuesto: PresupuestoInput = {
      id: id as string,
      paciente_id: input.pacienteId as string,
      turno_id: input.turnoId ?? null,
      estado: ESTADO_INICIAL,
      total_centavos: total,
      cobertura_centavos: cobertura,
      saldo_centavos: saldo,
      obra_social_plan_id: planId,
    };

    this.uow.runInTransaction(() => {
      this.repo.insertar(presupuesto);
    });

    return this.obtenerPresupuesto(id);
  }

  // ── 4.2 Autocalculo cobertura/saldo ──
  private obtenerCoberturaPctPaciente(pacienteId: PacienteId): number {
    const planId = this.obtenerPlanIdPaciente(pacienteId);
    if (planId === null) return 0;
    const row = this.db
      .prepare(
        `SELECT cobertura_pct FROM obra_social_plan WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(planId) as { cobertura_pct: number } | undefined;
    return row?.cobertura_pct ?? 0;
  }

  private obtenerPlanIdPaciente(pacienteId: PacienteId): ObraSocialPlanId | null {
    const row = this.db
      .prepare(
        `SELECT obra_social_plan_id FROM paciente WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(pacienteId as string) as { obra_social_plan_id: string | null } | undefined;
    return (row?.obra_social_plan_id ?? null) as ObraSocialPlanId | null;
  }

  private calcularCobertura(total: number, pct: number): number {
    return Math.floor((total * pct) / 100);
  }

  private recalcularCoberturaSaldo(
    pacienteId: PacienteId,
    total: number,
  ): { cobertura: number; saldo: number } {
    const pct = this.obtenerCoberturaPctPaciente(pacienteId);
    const cobertura = this.calcularCobertura(total, pct);
    return { cobertura, saldo: total - cobertura };
  }

  cambiarPaciente(
    presupuestoId: PresupuestoId,
    nuevoPacienteId: PacienteId,
  ): PresupuestoConItems {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    if (presupuesto.estado !== 'borrador') {
      throw new AppError({
        status: 400,
        code: 'edicion_no_permitida',
        message: 'solo se puede editar en estado borrador',
      });
    }

    this.validarTurnoPerteneceAPaciente(
      nuevoPacienteId,
      presupuesto.turno_id ? (presupuesto.turno_id as TurnoId) : null,
    );

    const { cobertura, saldo } = this.recalcularCoberturaSaldo(
      nuevoPacienteId,
      presupuesto.total_centavos,
    );
    const planId = this.obtenerPlanIdPaciente(nuevoPacienteId);

    this.uow.runInTransaction(() => {
      this.db
        .prepare(
          `UPDATE presupuesto
            SET paciente_id = ?, obra_social_plan_id = ?, cobertura_centavos = ?, saldo_centavos = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          nuevoPacienteId as string,
          planId,
          cobertura,
          saldo,
          new Date().toISOString(),
          presupuestoId as string,
        );
    });

    return this.obtenerPresupuesto(presupuestoId);
  }

  // ── 4.3 Máquina de estados ──
  transicionarEstado(
    presupuestoId: PresupuestoId,
    hacia: PresupuestoEstado,
  ): PresupuestoConItems {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }

    const desde = presupuesto.estado as PresupuestoEstado;
    if (!esTransicionValida(desde, hacia)) {
      throw new AppError({
        status: 400,
        code: 'transicion_invalida',
        message: `transicion invalida de ${desde} a ${hacia}`,
      });
    }

    this.uow.runInTransaction(() => {
      this.repo.updateEstado(presupuestoId as string, hacia);
    });

    return this.obtenerPresupuesto(presupuestoId);
  }

  // ── 4.4 Edición solo en borrador ──
  editarPresupuesto(
    presupuestoId: PresupuestoId,
    cambios: EditarPresupuestoInput,
  ): PresupuestoConItems {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    if (presupuesto.estado !== 'borrador') {
      throw new AppError({
        status: 400,
        code: 'edicion_no_permitida',
        message: 'solo se puede editar en estado borrador',
      });
    }

    let total = presupuesto.total_centavos;
    let cobertura = presupuesto.cobertura_centavos;
    let saldo = presupuesto.saldo_centavos;
    let planId: ObraSocialPlanId | null = presupuesto.obra_social_plan_id
      ? (presupuesto.obra_social_plan_id as ObraSocialPlanId)
      : null;

    if (cambios.total_centavos !== undefined) {
      total = cambios.total_centavos;
      const pct = this.obtenerCoberturaPctPaciente(presupuesto.paciente_id as PacienteId);
      cobertura = this.calcularCobertura(total, pct);
      saldo = total - cobertura;
    }
    if (cambios.obra_social_plan_id !== undefined) {
      planId = cambios.obra_social_plan_id;
      const pct = planId !== null ? this.obtenerCoberturaPctPacienteFromPlan(planId) : 0;
      cobertura = this.calcularCobertura(total, pct);
      saldo = total - cobertura;
    }

    this.uow.runInTransaction(() => {
      this.repo.updateTotales(presupuestoId as string, total, cobertura, saldo);
      if (planId !== presupuesto.obra_social_plan_id) {
        this.db
          .prepare(
            `UPDATE presupuesto
              SET obra_social_plan_id = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(planId, new Date().toISOString(), presupuestoId as string);
      }
    });

    return this.obtenerPresupuesto(presupuestoId);
  }

  private obtenerCoberturaPctPacienteFromPlan(
    planId: ObraSocialPlanId,
  ): number {
    const row = this.db
      .prepare(
        `SELECT cobertura_pct FROM obra_social_plan WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(planId as string) as { cobertura_pct: number } | undefined;
    return row?.cobertura_pct ?? 0;
  }

  // ── 4.5 Ítems ──
  agregarItem(
    presupuestoId: PresupuestoId,
    input: AgregarItemInput,
  ): ItemPresupuesto {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    if (presupuesto.estado !== 'borrador') {
      throw new AppError({
        status: 400,
        code: 'edicion_no_permitida',
        message: 'solo se puede editar en estado borrador',
      });
    }

    if (input.monto_centavos < 0) {
      throw new AppError({
        status: 400,
        code: 'monto_invalido',
        message: 'monto_centavos debe ser >= 0',
      });
    }

    if (input.pieza_fdi !== null || input.superficie !== null) {
      this.validarVinculoOdontograma(
        presupuesto.paciente_id,
        input.pieza_fdi,
        input.superficie,
      );
    }

    const id = crypto.randomUUID() as ItemPresupuestoId;
    const item: ItemPresupuestoInput = {
      id: id as string,
      presupuesto_id: presupuestoId as string,
      descripcion: input.descripcion,
      monto_centavos: input.monto_centavos,
      pieza_fdi: input.pieza_fdi,
      superficie: input.superficie,
    };

    this.uow.runInTransaction(() => {
      this.itemRepo.insertar(item);
      const nuevoTotal = this.calcularTotalPresupuesto(presupuestoId as string);
      const { cobertura, saldo } = this.recalcularCoberturaSaldo(
        presupuesto.paciente_id as PacienteId,
        nuevoTotal,
      );
      this.repo.updateTotales(presupuestoId as string, nuevoTotal, cobertura, saldo);
    });

    return this.obtenerItem(id);
  }

  editarItem(
    itemId: ItemPresupuestoId,
    input: EditarItemInput,
  ): ItemPresupuesto {
    const item = this.obtenerItemRow(itemId);
    if (!item) {
      throw new AppError({
        status: 404,
        code: 'item_no_encontrado',
        message: 'item no encontrado',
      });
    }

    const presupuesto = this.repo.findById(item.presupuesto_id);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    if (presupuesto.estado !== 'borrador') {
      throw new AppError({
        status: 400,
        code: 'edicion_no_permitida',
        message: 'solo se puede editar en estado borrador',
      });
    }

    let monto = item.monto_centavos;
    if (input.monto_centavos !== undefined) {
      if (input.monto_centavos < 0) {
        throw new AppError({
          status: 400,
          code: 'monto_invalido',
          message: 'monto_centavos debe ser >= 0',
        });
      }
      monto = input.monto_centavos;
    }

    let piezaFdi = item.pieza_fdi;
    let superficie = item.superficie;
    if (input.pieza_fdi !== undefined || input.superficie !== undefined) {
      piezaFdi = input.pieza_fdi ?? item.pieza_fdi;
      superficie = input.superficie ?? item.superficie;
      if (piezaFdi !== null || superficie !== null) {
        this.validarVinculoOdontograma(
          presupuesto.paciente_id,
          piezaFdi,
          superficie,
        );
      }
    }

    this.uow.runInTransaction(() => {
      this.db
        .prepare(
          `UPDATE item_presupuesto
            SET descripcion = COALESCE(?, descripcion),
                monto_centavos = ?,
                pieza_fdi = ?,
                superficie = ?,
                updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.descripcion ?? item.descripcion,
          monto,
          piezaFdi,
          superficie,
          new Date().toISOString(),
          itemId as string,
        );
      const nuevoTotal = this.calcularTotalPresupuesto(item.presupuesto_id);
      const { cobertura, saldo } = this.recalcularCoberturaSaldo(
        presupuesto.paciente_id as PacienteId,
        nuevoTotal,
      );
      this.repo.updateTotales(item.presupuesto_id, nuevoTotal, cobertura, saldo);
    });

    return this.obtenerItem(itemId);
  }

  eliminarItem(itemId: ItemPresupuestoId): void {
    const item = this.obtenerItemRow(itemId);
    if (!item) {
      throw new AppError({
        status: 404,
        code: 'item_no_encontrado',
        message: 'item no encontrado',
      });
    }

    const presupuesto = this.repo.findById(item.presupuesto_id);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    if (presupuesto.estado !== 'borrador') {
      throw new AppError({
        status: 400,
        code: 'edicion_no_permitida',
        message: 'solo se puede editar en estado borrador',
      });
    }

    this.uow.runInTransaction(() => {
      this.db
        .prepare(
          `UPDATE item_presupuesto SET deleted_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(new Date().toISOString(), new Date().toISOString(), itemId as string);
      const nuevoTotal = this.calcularTotalPresupuesto(item.presupuesto_id);
      const { cobertura, saldo } = this.recalcularCoberturaSaldo(
        presupuesto.paciente_id as PacienteId,
        nuevoTotal,
      );
      this.repo.updateTotales(item.presupuesto_id, nuevoTotal, cobertura, saldo);
    });
  }

  obtenerPresupuesto(presupuestoId: PresupuestoId): PresupuestoConItems {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    const items = this.itemRepo.findByPresupuesto(presupuestoId as string);
    return {
      id: presupuesto.id as PresupuestoId,
      paciente_id: presupuesto.paciente_id as PacienteId,
      turno_id: presupuesto.turno_id ? (presupuesto.turno_id as TurnoId) : null,
      estado: presupuesto.estado as PresupuestoEstado,
      total_centavos: presupuesto.total_centavos,
      cobertura_centavos: presupuesto.cobertura_centavos,
      saldo_centavos: presupuesto.saldo_centavos,
      obra_social_plan_id: presupuesto.obra_social_plan_id
        ? (presupuesto.obra_social_plan_id as ObraSocialPlanId)
        : null,
      created_at: presupuesto.created_at,
      updated_at: presupuesto.updated_at,
      deleted_at: presupuesto.deleted_at,
      items: items.map((it) => ({
        id: it.id as ItemPresupuestoId,
        presupuesto_id: it.presupuesto_id as PresupuestoId,
        descripcion: it.descripcion,
        monto_centavos: it.monto_centavos,
        pieza_fdi: it.pieza_fdi,
        superficie: it.superficie as any,
        created_at: it.created_at,
        deleted_at: it.deleted_at,
      })),
    };
  }

  listarPorPaciente(pacienteId: PacienteId): PresupuestoConItems[] {
    const presupuestos = this.repo.listarPorPaciente(pacienteId as string);
    return presupuestos.map((p) => {
      const items = this.itemRepo.findByPresupuesto(p.id);
      return {
        id: p.id as PresupuestoId,
        paciente_id: p.paciente_id as PacienteId,
        turno_id: p.turno_id ? (p.turno_id as TurnoId) : null,
        estado: p.estado as PresupuestoEstado,
        total_centavos: p.total_centavos,
        cobertura_centavos: p.cobertura_centavos,
        saldo_centavos: p.saldo_centavos,
        obra_social_plan_id: p.obra_social_plan_id
          ? (p.obra_social_plan_id as ObraSocialPlanId)
          : null,
        created_at: p.created_at,
        updated_at: p.updated_at,
        deleted_at: p.deleted_at,
        items: items.map((it) => ({
          id: it.id as ItemPresupuestoId,
          presupuesto_id: it.presupuesto_id as PresupuestoId,
          descripcion: it.descripcion,
          monto_centavos: it.monto_centavos,
          pieza_fdi: it.pieza_fdi,
          superficie: it.superficie as any,
          created_at: it.created_at,
          deleted_at: it.deleted_at,
        })),
      };
    });
  }

  eliminarPresupuesto(presupuestoId: PresupuestoId): void {
    const presupuesto = this.repo.findById(presupuestoId as string);
    if (!presupuesto) {
      throw new AppError({
        status: 404,
        code: 'presupuesto_no_encontrado',
        message: 'presupuesto no encontrado',
      });
    }
    this.repo.softDelete(presupuestoId as string);
    this.itemRepo.softDeleteItemsPresupuesto(presupuestoId as string);
  }

  // ── Validaciones privadas ──
  private validarTurnoPerteneceAPaciente(
    pacienteId: PacienteId,
    turnoId: TurnoId | null,
  ): void {
    if (turnoId === null || turnoId === undefined) return;
    const row = this.db
      .prepare(
        `SELECT 1 FROM turno WHERE id = ? AND paciente_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(turnoId as string, pacienteId as string) as { id: string } | undefined;
    if (!row) {
      throw new AppError({
        status: 400,
        code: 'turno_no_pertenece_a_paciente',
        message: 'el turno no pertenece al paciente indicado',
      });
    }
  }

  private validarVinculoOdontograma(
    pacienteId: string,
    piezaFdi: number | null,
    superficie: string | null,
  ): void {
    if (piezaFdi === null || superficie === null) return;
    const row = this.db
      .prepare(
        `SELECT 1 FROM odontograma_evento
         WHERE paciente_id = ? AND pieza_fdi = ? AND superficie = ?
         LIMIT 1`,
      )
      .get(pacienteId, piezaFdi, superficie) as { id: string } | undefined;
    if (!row) {
      throw new AppError({
        status: 400,
        code: 'vinculo_odontograma_invalido',
        message: 'no existe evento de odontograma vigente para esa pieza/superficie',
      });
    }
  }

  private calcularTotalPresupuesto(presupuestoId: string): number {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total FROM item_presupuesto
         WHERE presupuesto_id = ? AND deleted_at IS NULL`,
      )
      .get(presupuestoId) as { total: number };
    return rows.total;
  }

  private obtenerItem(itemId: ItemPresupuestoId): ItemPresupuesto {
    const row = this.obtenerItemRow(itemId);
    if (!row) {
      throw new AppError({
        status: 404,
        code: 'item_no_encontrado',
        message: 'item no encontrado',
      });
    }
    return {
      id: row.id as ItemPresupuestoId,
      presupuesto_id: row.presupuesto_id as PresupuestoId,
      descripcion: row.descripcion,
      monto_centavos: row.monto_centavos,
      pieza_fdi: row.pieza_fdi,
      superficie: row.superficie as any,
      created_at: row.created_at,
      deleted_at: row.deleted_at,
    };
  }

  private obtenerItemRow(itemId: ItemPresupuestoId) {
    return this.db
      .prepare(
        `SELECT * FROM item_presupuesto WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(itemId as string) as
        | {
            id: string;
            presupuesto_id: string;
            descripcion: string;
            monto_centavos: number;
            pieza_fdi: number | null;
            superficie: string | null;
            created_at: string;
            updated_at: string;
            deleted_at: string | null;
          }
        | undefined;
  }
}

export { ESTADO_INICIAL };
