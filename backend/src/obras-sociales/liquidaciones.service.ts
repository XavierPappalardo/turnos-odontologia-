/**
 * Servicio de liquidaciones de obra social (C-12, F-08).
 * Máquina de estados Q2: borrador -> presentada -> pagada.
 * Filtro por turno.inicio UTC (Q3) y estado = 'atendido' (Q4).
 * Historial append-only y transacciones BEGIN IMMEDIATE (R8, R9, R16).
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ObraSocialPlanRepository } from '../core/obraSocialPlan.repository.js';
import { UnitOfWork } from '../shared/repository.js';
import {
  LIQUIDACION_OS_TRANSICIONES,
  type LiquidacionOsEstado,
  type LiquidacionOsEvento,
} from '../shared/types.js';
import {
  CoberturaRepository,
  type CoberturaTurnoRow,
} from './cobertura.repository.js';
import { MontoNoRepresentableError } from './coberturas.service.js';
import {
  ObraSocialConflictoError,
  ObraSocialNotFoundError,
  ObraSocialValidacionError,
} from './errors.js';
import {
  LiquidacionRepository,
  type LiquidacionRow,
} from './liquidacion.repository.js';
import {
  LiquidacionEventoRepository,
  type EventoLiquidacionOsRow,
} from './liquidacionEvento.repository.js';
import {
  LiquidacionItemRepository,
  type LiquidacionItemRow,
} from './liquidacionItem.repository.js';

export interface GenerarLiquidacionInput {
  obra_social_plan_id: string;
  desde: string;
  hasta: string;
}

export interface LiquidacionDetalle {
  liquidacion: LiquidacionRow;
  items: LiquidacionItemRow[];
  eventos: EventoLiquidacionOsRow[];
}

export class LiquidacionesService {
  private readonly liqRepo: LiquidacionRepository;
  private readonly itemRepo: LiquidacionItemRepository;
  private readonly eventoRepo: LiquidacionEventoRepository;
  private readonly cobRepo: CoberturaRepository;
  private readonly planRepo: ObraSocialPlanRepository;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.liqRepo = new LiquidacionRepository(db);
    this.itemRepo = new LiquidacionItemRepository(db);
    this.eventoRepo = new LiquidacionEventoRepository(db);
    this.cobRepo = new CoberturaRepository(db);
    this.planRepo = new ObraSocialPlanRepository(db);
    this.uow = new UnitOfWork(db);
  }

  generarBorrador(
    input: GenerarLiquidacionInput,
    actorUsuarioId: string,
  ): LiquidacionDetalle {
    if (!input.obra_social_plan_id) {
      throw new ObraSocialValidacionError('obra_social_plan_id es requerido');
    }

    if (!input.desde || typeof input.desde !== 'string') {
      throw new ObraSocialValidacionError('desde es requerido');
    }

    if (!input.hasta || typeof input.hasta !== 'string') {
      throw new ObraSocialValidacionError('hasta es requerido');
    }

    // Validar rango inclusivo [desde, hasta]
    if (input.desde > input.hasta) {
      throw new ObraSocialValidacionError(
        'El rango es inválido: desde no puede ser posterior a hasta',
      );
    }

    // 1. Validar que el plan exista y esté vigente
    const plan = this.planRepo.buscarPorIdVigente(input.obra_social_plan_id);
    if (!plan || plan.activo === 0) {
      throw new ObraSocialNotFoundError(
        'Plan de obra social inexistente o de baja lógica',
      );
    }

    // 2. Verificar unicidad de liquidación por plan y período (409)
    const previa = this.liqRepo.buscarPorPlanYPeriodoVigente(
      input.obra_social_plan_id,
      input.desde,
      input.hasta,
    );
    if (previa) {
      throw new ObraSocialConflictoError(
        'Ya existe una liquidación vigente para este plan y período',
      );
    }

    // 3. Buscar coberturas elegibles en [desde, hasta] según turno.inicio (Q3) y estado = 'atendido' (Q4)
    const elegibles = this.liqRepo.buscarCoberturasElegibles(
      input.obra_social_plan_id,
      input.desde,
      input.hasta,
    );

    if (elegibles.length === 0) {
      throw new ObraSocialValidacionError(
        'No existen coberturas elegibles para liquidar en el período especificado',
      );
    }

    // 4. Ejecución transaccional BEGIN IMMEDIATE con UnitOfWork
    return this.uow.runInTransaction(() => {

      const totalCentavos = elegibles.reduce(
        (sum, item) => sum + item.cobertura_centavos,
        0,
      );

      // F6 (límite seguro): el total de la cabecera debe permanecer como
      // entero exacto representable (R2/R5), coherente con calcularCobertura.
      // Un valor por encima de Number.MAX_SAFE_INTEGER (pérdida de precisión
      // o REAL en SQLite) dispara error de dominio y ROLLBACK del UnitOfWork,
      // con lo que la cabecera y sus ítems no llegan a existir.
      if (!Number.isSafeInteger(totalCentavos)) {
        throw new MontoNoRepresentableError(
          'El total de la liquidación excede Number.MAX_SAFE_INTEGER',
        );
      }

      const liqId = randomUUID();
      const now = new Date().toISOString();

      const liquidacionRow: LiquidacionRow = {
        id: liqId,
        obra_social_plan_id: input.obra_social_plan_id,
        desde: input.desde,
        hasta: input.hasta,
        estado: 'borrador',
        monto_total_centavos: totalCentavos,
        generada_por_usuario_id: actorUsuarioId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      try {
        this.liqRepo.insert(liquidacionRow);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          (err.message.includes('UNIQUE') ||
            err.message.includes('SQLITE_CONSTRAINT'))
        ) {
          throw new ObraSocialConflictoError(
            'Conflicto de unicidad al crear la liquidación',
          );
        }
        throw err;
      }

      // Insertar ítems con snapshot
      for (const cob of elegibles) {
        const itemId = randomUUID();
        this.itemRepo.insert({
          id: itemId,
          liquidacion_id: liqId,
          cobertura_id: cob.id,
          turno_id: cob.turno_id,
          monto_cobertura_centavos: cob.cobertura_centavos,
          saldo_paciente_centavos: cob.saldo_paciente_centavos,
          cobertura_pct: cob.cobertura_pct,
          deleted_at: null,
        });
      }

      // Insertar evento 'generada' en el historial append-only
      const eventoId = randomUUID();
      this.eventoRepo.insert({
        id: eventoId,
        liquidacion_id: liqId,
        evento: 'generada',
        actor_usuario_id: actorUsuarioId,
        ocurrido_en: now,
      });

      return {
        liquidacion: this.liqRepo.buscarPorIdVigente(liqId)!,
        items: this.itemRepo.listarPorLiquidacion(liqId),
        eventos: this.eventoRepo.listarPorLiquidacion(liqId),
      };
    });
  }

  /**
   * Validaciones de elegibilidad del par liquidación/cobertura, compartidas
   * por el check rápido previo a la transacción y por el re-chequeo intra-tx
   * (obs. auditoría F1/F3): una sola fuente de verdad para ambas pasadas.
   */
  private validarItemElegible(
    liqActual: LiquidacionRow,
    cobActual: CoberturaTurnoRow,
  ): void {
    if (liqActual.estado !== 'borrador') {
      throw new ObraSocialConflictoError(
        'Solo se pueden agregar ítems a una liquidación en estado borrador',
      );
    }

    if (cobActual.obra_social_plan_id !== liqActual.obra_social_plan_id) {
      throw new ObraSocialValidacionError(
        'La cobertura no pertenece al plan de la liquidación',
      );
    }

    // Verificar si ya está liquidada en cualquier liquidación vigente
    if (this.cobRepo.estaEnLiquidacionVigente(cobActual.id)) {
      throw new ObraSocialValidacionError(
        'La cobertura ya está incluida en una liquidación vigente',
      );
    }

    // Verificar elegibilidad de turno: atendido y dentro de [desde, hasta] (Q3/Q4)
    const turno = this.cobRepo.buscarTurnoPorId(cobActual.turno_id);

    if (
      !turno ||
      turno.deleted_at !== null ||
      turno.estado !== 'atendido' ||
      turno.inicio < liqActual.desde ||
      turno.inicio > liqActual.hasta
    ) {
      throw new ObraSocialValidacionError(
        'El turno no es elegible (debe estar atendido y en el rango de fechas)',
      );
    }
  }

  agregarItem(
    liquidacionId: string,
    coberturaId: string,
  ): LiquidacionItemRow {
    // Check rápido fuera de la tx (fail-fast); la verificación EXIGIBLE se
    // repite contra el estado real de la BD dentro de la transacción (F1/F3).
    const liq = this.liqRepo.buscarPorIdVigente(liquidacionId);
    if (!liq) {
      throw new ObraSocialNotFoundError('Liquidación no encontrada');
    }

    const cob = this.cobRepo.buscarPorIdVigente(coberturaId);
    if (!cob) {
      throw new ObraSocialNotFoundError('Cobertura no encontrada');
    }

    this.validarItemElegible(liq, cob);

    return this.uow.runInTransaction(() => {
      // Re-lectura intra-transacción (F1/F3): BEGIN IMMEDIATE serializa los
      // escritores, de modo que dos agregarItem concurrentes revalidan contra
      // el estado real y el perdedor obtiene 409/400 en lugar de mezclar
      // lecturas viejas (lost-update).
      const liqActual = this.liqRepo.buscarPorIdVigente(liquidacionId);
      if (!liqActual) {
        throw new ObraSocialNotFoundError('Liquidación no encontrada');
      }

      const cobActual = this.cobRepo.buscarPorIdVigente(coberturaId);
      if (!cobActual) {
        throw new ObraSocialNotFoundError('Cobertura no encontrada');
      }

      this.validarItemElegible(liqActual, cobActual);

      // F1 (lost-update): el total NUNCA se deriva del monto leído fuera de la
      // tx; se recalcula como SUM de los ítems vigentes DENTRO de la
      // transacción (método de repositorio, R8: sin SQL en el servicio) y se
      // persiste atómicamente con el insert del ítem.
      const sumaVigente =
        this.itemRepo.sumarVigentesPorLiquidacion(liqActual.id);
      const nuevoTotal = sumaVigente + cobActual.cobertura_centavos;

      // F6 (límite seguro): rechaza totales no representables como enteros
      // exactos (pérdida de precisión / REAL en SQLite) con error de dominio
      // y rollback del UnitOfWork: el ítem no se persiste.
      if (!Number.isSafeInteger(nuevoTotal)) {
        throw new MontoNoRepresentableError(
          'El total de la liquidación excede Number.MAX_SAFE_INTEGER',
        );
      }

      const itemId = randomUUID();
      const itemRow: LiquidacionItemRow = {
        id: itemId,
        liquidacion_id: liqActual.id,
        cobertura_id: cobActual.id,
        turno_id: cobActual.turno_id,
        monto_cobertura_centavos: cobActual.cobertura_centavos,
        saldo_paciente_centavos: cobActual.saldo_paciente_centavos,
        cobertura_pct: cobActual.cobertura_pct,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };

      try {
        this.itemRepo.insert(itemRow);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          (err.message.includes('UNIQUE') ||
            err.message.includes('SQLITE_CONSTRAINT'))
        ) {
          throw new ObraSocialConflictoError(
            'El turno ya está incluido en otra liquidación',
          );
        }
        throw err;
      }

      // F3: la escritura se comprueba; sin filas afectadas (cabecera dada de
      // baja concurrentemente tras el re-chequeo) el ROLLBACK revierte el
      // ítem y la respuesta exacta es 404 en lugar de éxito silencioso.
      const ok = this.liqRepo.update(liqActual.id, {
        monto_total_centavos: nuevoTotal,
      });
      if (!ok) {
        throw new ObraSocialNotFoundError('Liquidación no encontrada');
      }

      return itemRow;
    });
  }

  /**
   * Máquina de estados aprobada (Q2): borrador -> presentada -> pagada, con
   * `pagada` terminal. El guard previo es un fail-fast; la verificación
   * EXIGIBLE acontece DENTRO de la transacción (obs. auditoría F3): la
   * re-lectura contra el estado real (BEGIN IMMEDIATE serializa escritores)
   * impide transiciones duplicadas/eventos repetidos por solicitudes
   * concurrentes.
   */
  transicionarEstado(
    liquidacionId: string,
    nuevoEstado: LiquidacionOsEstado,
    actorUsuarioId: string,
  ): LiquidacionRow {
    const liq = this.liqRepo.buscarPorIdVigente(liquidacionId);
    if (!liq) {
      throw new ObraSocialNotFoundError('Liquidación no encontrada');
    }

    this.validarTransicion(liq, nuevoEstado);

    return this.uow.runInTransaction(() => {
      // Re-lectura intra-transacción (F3) contra el estado real de la BD.
      const actual = this.liqRepo.buscarPorIdVigente(liquidacionId);
      if (!actual) {
        throw new ObraSocialNotFoundError('Liquidación no encontrada');
      }

      this.validarTransicion(actual, nuevoEstado);

      // La escritura se comprueba: sin filas afectadas (la cabecera fue
      // eliminada entre la lectura y el patch) el ROLLBACK revierte el evento
      // y la respuesta exacta es 404 en lugar de éxito silencioso.
      const ok = this.liqRepo.update(actual.id, { estado: nuevoEstado });
      if (!ok) {
        throw new ObraSocialNotFoundError('Liquidación no encontrada');
      }

      const now = new Date().toISOString();

      // Insertar evento en el historial append-only. Los eventos del historial
      // son 'generada'/'presentada'/'pagada': 'borrador' es el estado semilla
      // y no existe como evento de transición (nunca es destino y en la
      // máquina de estados la creación ya se registra como 'generada').
      const eventoDeTransicion: Record<LiquidacionOsEstado, LiquidacionOsEvento> = {
        borrador: 'generada',
        presentada: 'presentada',
        pagada: 'pagada',
      };
      const eventoId = randomUUID();
      this.eventoRepo.insert({
        id: eventoId,
        liquidacion_id: actual.id,
        evento: eventoDeTransicion[nuevoEstado],
        actor_usuario_id: actorUsuarioId,
        ocurrido_en: now,
      });

      return this.liqRepo.buscarPorIdVigente(actual.id)!;
    });
  }

  /** Guard de máquina de estados (Q2), compartido por ambas pasadas (F3). */
  private validarTransicion(
    liq: LiquidacionRow,
    nuevoEstado: LiquidacionOsEstado,
  ): void {
    const permitidos = LIQUIDACION_OS_TRANSICIONES.get(liq.estado) ?? [];
    if (!permitidos.includes(nuevoEstado)) {
      throw new ObraSocialConflictoError(
        `Transición inválida de ${liq.estado} a ${nuevoEstado}`,
      );
    }
  }

  /**
   * Baja lógica de la liquidación (spec "Unicidad de liquidación por plan y
   * período", obs. 6.5): sella la cabecera y, en LA MISMA transacción del
   * UnitOfWork, da de baja sus ítems vigentes para liberar el guard
   * `os_item_turno_liquidado_unico` y permitir la re-emisión del período.
   * Los eventos del historial append-only NO se tocan (inmutabilidad D2).
   */
  darDeBaja(id: string): void {
    this.uow.runInTransaction(() => {
      const ok = this.liqRepo.softDelete(id);
      if (!ok) {
        throw new ObraSocialNotFoundError('Liquidación no encontrada');
      }
      this.itemRepo.darDeBajaPorLiquidacion(id);
    });
  }

  obtenerDetalle(id: string): LiquidacionDetalle {
    const liquidacion = this.liqRepo.buscarPorIdVigente(id);
    if (!liquidacion) {
      throw new ObraSocialNotFoundError('Liquidación no encontrada');
    }

    const items = this.itemRepo.listarPorLiquidacion(id);
    const eventos = this.eventoRepo.listarPorLiquidacion(id);

    return {
      liquidacion,
      items,
      eventos,
    };
  }

  listar(planId?: string): LiquidacionRow[] {
    return this.liqRepo.listarVigentes(planId);
  }
}
