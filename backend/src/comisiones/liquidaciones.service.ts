/**
 * Servicios de liquidación de comisiones (C-13, tasks 5.2/5.3; D8/D9/D12/D13).
 * Patrón F1 (C-12 refinado por D13): TODO el estado vivo se RE-LÉ y el cálculo
 * se RE-DERIVA DENTRO de la transacción `BEGIN IMMEDIATE` (UnitOfWork, R12);
 * el `fingerprint` recibido se compara contra la derivación viva — divergencia
 * → `409 preview_desactualizado` SIN persistir nada (el rollback revierte
 * también bajas y liberaciones precedentes). NUNCA exclusión silenciosa ni
 * recálculo de un resultado distinto del revisado (P2/D13).
 *
 * Semántica de cada operación:
 *  - `calcularPreview`: lectura pura sin persistencia; responde ítems,
 *    descartes consultables, ajustes pendientes, pagos ya capturados (D7),
 *    totales exactas y fingerprint canónico (D13). Sin % general vigente →
 *    `422 sin_configuracion` (no se materializa fingerprint con config null).
 *  - `generarBorrador`: guarda `periodo_ya_liquidado` (rápida fuera + UNIQUE
 *    dentro), re-deriva intra-tx y, solo con fingerprint vigente, inserta en
 *    UNA tx: cabecera `borrador` + ítems-snapshot + reservas de ajustes
 *    (orden canon D12) + evento append-only `generada`. Un borrador sin
 *    ítems ni ajustes (nada que revisar) se rechaza con `validacion`.
 *  - `regenerarBorrador` (solo borradores): precedencia intra-tx baja lógica
 *    de ítems + liberación de reservas PROPIAS → re-derivación excluyendo su
 *    propio estado (`excluirBorradorId = self`) → fingerprint divergente
 *    → 409 con ROLLBACK íntegro de las bajas. NO appendea evento nuevo
 *    (el historial previo se conserva — spec). Permite derivación vacía
 *    (p. ej. único cobro anulado: el borrador legítimamente queda 0/0/0).
 *  - `confirmarBorrador` (borrador → confirmada, D5): re-deriva con
 *    `excluirBorradorId = self` contra el fingerprint almacenado/recibido;
 *    absorción in-order D12 fila a fila con capacidad `monto_items`
 *    (compensación parcial permitida; la fila queda `consumido` con
 *    `compensado_en` aunque su resto no se absorba → arrastre P1);
 *    transición atómica `confirmar()` (estado + montos + saldo + fingerprint
 *    en un solo UPDATE con el CHECK CASE del DDL) + evento `confirmada`.
 *    Sin pagos negativos automáticos: el saldo es pasivo y se arrastra (P1).
 *    Llamada posterior sobre confirmada → `estado_invalido`.
 *
 * Concurrencia (D7/D13): SQLite impone escritor único real con
 * `BEGIN IMMEDIATE`; la segunda generación/confirmación con fingerprint o
 * estado previos responde 409 (`preview_desactualizado`/`estado_invalido`)
 * sin filas residuales. El `UnitOfWork` no reintenta `SQLITE_BUSY`
 * (documentado): una segunda conexión REAL que abra escritura mientras otra
 * la sostiene recibe el error crudo de SQLite y es reintentable.
 *
 * R8: SOLO repositorios; R2: enteros exactos (motor BigInt); R3: sin PHI.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository, UnitOfWork, nowIsoUtc } from '../shared/repository.js';
import { ComisionError } from '../shared/errors.js';
import { PagoRepository } from '../core/pago.repository.js';
import {
  ProfesionalComisionRepository,
  ProfesionalComisionTratamientoRepository,
} from './config.repository.js';
import {
  LiquidacionAjusteRepository,
  type AjusteComisionRow,
} from './liquidacionAjuste.repository.js';
import {
  LiquidacionComisionRepository,
  type LiquidacionComisionRow,
  type MontosLiquidacion,
} from './liquidacion.repository.js';
import {
  LiquidacionItemRepository,
  type ItemLiquidacionComisionRow,
} from './liquidacionItem.repository.js';
import {
  LiquidacionEventoRepository,
  type EventoLiquidacionComisionRow,
} from './liquidacionEvento.repository.js';
import {
  calcularLiquidacion,
  compararTextoCanonico,
  type AjustePendienteCalculado,
  type DescarteCalculo,
  type ItemCalculado,
  type ResultadoCalculo,
  type TotalesCalculo,
} from './calculo.js';
import { calcularFingerprint } from './fingerprint.js';
import { esViolacionUnica } from './configuraciones.service.js';

/** Fila mínima de `profesional` para la verificación de actividad (R4/R8). */
interface ProfesionalFila {
  id: string;
  activo: number;
}

export const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export interface ResumenPreviewComision {
  profesional_id: string;
  desde: string;
  hasta: string;
  /** Ítems elegibles en orden canon `pago_id` (D13). */
  items: ItemCalculado[];
  /** Descartes con motivo EXPLÍCITO (nunca exclusión silenciosa, D2/D7). */
  descartes: DescarteCalculo[];
  /** Ajustes pendientes en orden de absorción D12 (candidatos a reservar). */
  ajustes: AjustePendienteCalculado[];
  /** `pago_id` ya capturados por OTRO borrador/liquidación vigente (D7). */
  pagos_ya_liquidados: string[];
  totales: TotalesCalculo;
  /** Fingerprint SHA-256 canon de TODO el cálculo vivo (D13). */
  fingerprint: string;
}

/** Cabecera + filas persistidas (ítems-snapshot y ajustes reservados). */
export interface BorradorPersistida {
  liquidacion: LiquidacionComisionRow;
  items: ItemLiquidacionComisionRow[];
  ajustes: AjusteComisionRow[];
}

/** Detalle completo de consulta: cabecera + filas + historial append-only. */
export interface DetalleLiquidacion {
  liquidacion: LiquidacionComisionRow;
  items: ItemLiquidacionComisionRow[];
  ajustes: AjusteComisionRow[];
  eventos: EventoLiquidacionComisionRow[];
}

export interface GenerarBorradorInput {
  profesionalId: string;
  /** `YYYY-MM-DD` (Q3: la fecha contable del cobro compara por día). */
  desde: string;
  hasta: string;
  /** Fingerprint de la preview a validar (D13). */
  fingerprint: string;
  actorUsuarioId: string;
}

export interface RegenerarBorradorInput {
  liquidacionId: string;
  fingerprint: string;
}

export interface ConfirmarBorradorInput {
  liquidacionId: string;
  fingerprint: string;
  actorUsuarioId: string;
}

interface DerivacionViva {
  resultado: ResultadoCalculo;
  fingerprint: string;
  pagosYaLiquidados: string[];
}

function errorValidacion(detalle: string): ComisionError {
  return new ComisionError({
    status: 422,
    code: 'validacion',
    message: 'validación de entrada',
    detalle,
  });
}

/**
 * Q3: la fecha contable del cobro (`YYYY-MM-DD`, CHECK GLOB del DDL) compara
 * por BETWEEN lexical con los límites del período — `desde`/`hasta` DEBEN ser
 * fecha-día ISO `YYYY-MM-DD` (R6). Un timestamp con hora rompería la
 * comparación del último día: rechazo con `validacion`.
 */
export function exigirFechaDiaISO(valor: unknown, campo: string): void {
  if (typeof valor !== 'string' || !FECHA_ISO_RE.test(valor)) {
    throw errorValidacion(`${campo} debe ser una fecha ISO YYYY-MM-DD`);
  }
  const mes = Number.parseInt(valor.slice(5, 7), 10);
  const dia = Number.parseInt(valor.slice(8, 10), 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    throw errorValidacion(`${campo} fuera de calendario`);
  }
}

function exigirRangoPeriodo(desde: unknown, hasta: unknown): void {
  exigirFechaDiaISO(desde, 'desde');
  exigirFechaDiaISO(hasta, 'hasta');
  if ((desde as string) > (hasta as string)) {
    throw errorValidacion('desde debe ser <= hasta');
  }
}

function exigirFingerprint(fingerprint: unknown): void {
  if (typeof fingerprint !== 'string' || !FINGERPRINT_RE.test(fingerprint)) {
    throw errorValidacion('fingerprint requerido (SHA-256 de 64 hex)');
  }
}

/** Clasifica la UNIQUE alcanzada por un error crudo de SQLite (D7/C-13). */
function clasificarViolacion(err: unknown): 'cabecera' | 'item' | 'ajuste' | null {
  if (!esViolacionUnica(err)) return null;
  const mensaje = (err as Error).message;
  if (mensaje.includes('liquidacion_comision_item.')) return 'item';
  if (mensaje.includes('liquidacion_comision_ajuste.')) return 'ajuste';
  return 'cabecera';
}

export class ComisionesLiquidacionesService {
  private readonly db: DatabaseSync;
  private readonly configs: ProfesionalComisionRepository;
  private readonly tratamientos: ProfesionalComisionTratamientoRepository;
  private readonly pagos: PagoRepository;
  private readonly cabeceras: LiquidacionComisionRepository;
  private readonly items: LiquidacionItemRepository;
  private readonly ajustes: LiquidacionAjusteRepository;
  private readonly eventos: LiquidacionEventoRepository;
  private readonly profesionales: BaseRepository<ProfesionalFila>;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.configs = new ProfesionalComisionRepository(db);
    this.tratamientos = new ProfesionalComisionTratamientoRepository(db);
    this.pagos = new PagoRepository(db);
    this.cabeceras = new LiquidacionComisionRepository(db);
    this.items = new LiquidacionItemRepository(db);
    this.ajustes = new LiquidacionAjusteRepository(db);
    this.eventos = new LiquidacionEventoRepository(db);
    this.profesionales = new BaseRepository<ProfesionalFila>(db, 'profesional');
    this.uow = new UnitOfWork(db);
  }

  private notFound(mensaje: string): ComisionError {
    return new ComisionError({ status: 404, code: 'not_found', message: mensaje });
  }

  private estadoInvalido(mensaje: string): ComisionError {
    return new ComisionError({ status: 409, code: 'estado_invalido', message: mensaje });
  }

  private previewDesactualizado(mensaje: string): ComisionError {
    return new ComisionError({
      status: 409,
      code: 'preview_desactualizado',
      message: mensaje,
    });
  }

  private exigirProfesionalActivo(profesionalId: string): void {
    const fila = this.profesionales.findById(profesionalId);
    if (fila === undefined || fila.activo !== 1) {
      throw this.notFound('profesional inexistente o inactivo');
    }
  }

  /**
   * Re-derivación del cálculo vivo (D13): config general + tratamientos
   * vigentes + cobros candidatos del período + detección D12 (pendientes,
   * con `excluirBorradorId` para re-incluir los candidatos reservados por la
   * PROPIA cabecera en regeneración/confirmación) + capturas D7. Todo se lee
   * en el momento de la llamada: las operaciones del servicio la invocan
   * DENTRO de la transacción.
   */
  private derivar(args: {
    profesionalId: string;
    desde: string;
    hasta: string;
    excluirBorradorId?: string;
  }): DerivacionViva {
    const configRow = this.configs.obtenerConfigVigente(args.profesionalId);
    if (configRow === undefined) {
      throw new ComisionError({
        status: 422,
        code: 'sin_configuracion',
        message: 'sin % general vigente para el profesional',
      });
    }
    const tratamientos = this.tratamientos.listarVigentes(args.profesionalId);
    const cobros = this.pagos.listarCobrosElegiblesComision(
      args.profesionalId,
      args.desde,
      args.hasta,
    );
    // Capturas D7 (membership) entre los candidatos: un pago con ítem vigente
    // en CUALQUIER liquidación ajena está tomado; el propio borrador excluido
    // no cuenta (hash estable generar ↔ regenerar ↔ confirmar, D13).
    const pagosYaLiquidados = cobros
      .filter((c) => c.motivo_descarte === null)
      .filter((c) => {
        const captura = this.items.buscarPorPagoIdVigente(c.pago_id);
        return captura !== undefined && captura.liquidacion_id !== args.excluirBorradorId;
      })
      .map((c) => c.pago_id);

    const anulacionesPendientes = this.ajustes.listarAnulacionesSinReserva(
      args.profesionalId,
      args.excluirBorradorId,
    );
    const saldosArrastre = this.ajustes.listarSaldosArrastre(args.profesionalId);

    const resultado = calcularLiquidacion({
      cobros,
      configGeneral: {
        id: configRow.id,
        profesional_id: configRow.profesional_id,
        pct_general: configRow.pct_general,
        updated_at: configRow.updated_at,
      },
      configsTratamiento: tratamientos,
      contexto: { pagosYaLiquidados, anulacionesPendientes, saldosArrastre },
    });
    const fingerprint = calcularFingerprint({
      profesional_id: args.profesionalId,
      desde: args.desde,
      hasta: args.hasta,
      config_general: {
        id: configRow.id,
        profesional_id: configRow.profesional_id,
        pct_general: configRow.pct_general,
        updated_at: configRow.updated_at,
      },
      tratamientos,
      cobros,
      ajustes_pendientes: resultado.ajustes,
      pagos_ya_liquidados: [...pagosYaLiquidados].sort(compararTextoCanonico),
    });
    return { resultado, fingerprint, pagosYaLiquidados };
  }

  /**
   * Vista previa sin persistencia (spec: 200 + fingerprint; nada queda).
   * Período EXACTO con borrador propio vigente (UNIQUE parcial) = vista de
   * REGENERACIÓN: la derivación excluye las capturas de ese borrador. Generar
   * para ese período está bloqueado y la única transición posible es
   * regenerar — el fingerprint utilizable en `regenerarBorrador` ES el de esta
   * derivación (de lo contrario la preview reportaría los cobros del propio
   * borrador como `cobro_ya_liquidado` y NINGÚN fingerprint permitiría
   * regenerar, bloqueando el flujo D13: re-previsualizar → regenerar →
   * confirmar). Períodos con liquidación `confirmada` u otros solapados NO se
   * excluyen: sus capturas quedan reportadas como capturas ajenas (D7/Q7).
   */
  calcularPreview(
    profesionalId: string,
    desde: string,
    hasta: string,
  ): ResumenPreviewComision {
    this.exigirProfesionalActivo(profesionalId);
    exigirRangoPeriodo(desde, hasta);
    const borradorMismoPeriodo =
      this.cabeceras.buscarPorProfesionalYPeriodoVigente(profesionalId, desde, hasta);
    const excluirBorradorId =
      borradorMismoPeriodo !== undefined && borradorMismoPeriodo.estado === 'borrador'
        ? borradorMismoPeriodo.id
        : undefined;
    const derivacion = this.derivar(
      excluirBorradorId === undefined
        ? { profesionalId, desde, hasta }
        : { profesionalId, desde, hasta, excluirBorradorId },
    );
    return {
      profesional_id: profesionalId,
      desde,
      hasta,
      items: derivacion.resultado.items,
      descartes: derivacion.resultado.descartes,
      ajustes: derivacion.resultado.ajustes,
      pagos_ya_liquidados: [...derivacion.pagosYaLiquidados].sort(compararTextoCanonico),
      totales: derivacion.resultado.totales,
      fingerprint: derivacion.fingerprint,
    };
  }

  /**
   * Guard D7 doble verificación (task 5.3): todo ítem a presevar debe estar
   * LIBRE; las capturas de la cabecera excluida no cuentan.
   */
  private exigirCobrosDisponibles(
    items: readonly ItemCalculado[],
    excluirBorradorId?: string,
  ): void {
    for (const item of items) {
      const captura = this.items.buscarPorPagoIdVigente(item.pago_id);
      if (captura !== undefined && captura.liquidacion_id !== excluirBorradorId) {
        throw new ComisionError({
          status: 409,
          code: 'cobro_ya_liquidado',
          message: 'cobro ya liquidado en otra liquidación vigente',
        });
      }
    }
  }

  /** Un borrador nuevo sin nada que revisar no tiene valor líquible. */
  private exigirContenidoLiquidable(resultado: ResultadoCalculo): void {
    if (resultado.items.length === 0 && resultado.ajustes.length === 0) {
      throw errorValidacion('sin ítems ni ajustes liquidables en el período');
    }
  }

  /** Ítems-snapshot en orden canon (D4/D13): la BD rechaza el doble cobro. */
  private insertarItems(liquidacionId: string, items: readonly ItemCalculado[]): void {
    for (const item of items) {
      try {
        this.items.insert({
          id: randomUUID(),
          liquidacion_id: liquidacionId,
          pago_id: item.pago_id,
          turno_id: item.turno_id,
          fecha_contable: item.fecha_contable,
          monto_cobro_centavos: item.monto_cobro_centavos,
          pct_aplicado: item.pct_aplicado,
          regla_aplicada: item.regla_aplicada,
          monto_comision_centavos: item.monto_comision_centavos,
        });
      } catch (err: unknown) {
        if (clasificarViolacion(err) === 'item') {
          throw new ComisionError({
            status: 409,
            code: 'cobro_ya_liquidado',
            message: 'ítem duplicado: cobro ya liquidado en vigencia ajena',
          });
        }
        throw err;
      }
    }
  }

  /** Reservas de ajustes en orden canon (D12): UNIQUE parcial exclusivo. */
  private insertarAjustesReservados(
    liquidacionId: string,
    ajustes: readonly AjustePendienteCalculado[],
  ): void {
    for (const ajuste of ajustes) {
      try {
        this.ajustes.insertarReservado({
          id: randomUUID(),
          liquidacion_id: liquidacionId,
          item_origen_id: ajuste.item_origen_id,
          pago_id: ajuste.pago_id,
          tipo_ajuste: ajuste.tipo_ajuste,
          monto_ajuste_centavos: ajuste.monto_ajuste_centavos,
        });
      } catch (err: unknown) {
        if (clasificarViolacion(err) === 'ajuste') {
          throw this.previewDesactualizado(
            'estado de reservas divergió del fingerprint revisado',
          );
        }
        throw err;
      }
    }
  }

  private obtenerCabeceraVigente(liquidacionId: string): LiquidacionComisionRow {
    const fila = this.cabeceras.buscarPorIdVigente(liquidacionId);
    if (fila === undefined) {
      throw this.notFound('liquidación inexistente');
    }
    return fila;
  }

  private leerFilas(liquidacionId: string): {
    items: ItemLiquidacionComisionRow[];
    ajustes: AjusteComisionRow[];
  } {
    return {
      items: this.items.listarPorLiquidacion(liquidacionId),
      ajustes: this.ajustes.listarPorLiquidacion(liquidacionId),
    };
  }

  /**
   * Generación del borrador (task 5.2): una sola tx `BEGIN IMMEDIATE` con
   * re-derivación intra-tx (fingerprint vivo vs recibido), cabecera, ítems,
   * reservas de ajustes y evento `generada`. Perdedor de la carrera: 409,
   * cero filas, reintentable con nueva preview.
   */
  generarBorrador(input: GenerarBorradorInput): BorradorPersistida {
    this.exigirProfesionalActivo(input.profesionalId);
    exigirRangoPeriodo(input.desde, input.hasta);
    exigirFingerprint(input.fingerprint);
    if (typeof input.actorUsuarioId !== 'string' || input.actorUsuarioId === '') {
      throw errorValidacion('actor requerido');
    }
    // Guard rápido fuera de la tx (fail-fast C-12); verificación exigible dentro.
    if (
      this.cabeceras.buscarPorProfesionalYPeriodoVigente(
        input.profesionalId,
        input.desde,
        input.hasta,
      ) !== undefined
    ) {
      throw new ComisionError({
        status: 409,
        code: 'periodo_ya_liquidado',
        message: 'ya existe una liquidación vigente para el período exacto',
      });
    }
    return this.uow.runInTransaction(() => {
      const existente = this.cabeceras.buscarPorProfesionalYPeriodoVigente(
        input.profesionalId,
        input.desde,
        input.hasta,
      );
      if (existente !== undefined) {
        throw new ComisionError({
          status: 409,
          code: 'periodo_ya_liquidado',
          message: 'ya existe una liquidación vigente para el período exacto',
        });
      }
      // Re-derivación DENTRO de la tx (F1/D13): divergencia → nada persiste.
      const derivacion = this.derivar({
        profesionalId: input.profesionalId,
        desde: input.desde,
        hasta: input.hasta,
      });
      if (derivacion.fingerprint !== input.fingerprint) {
        throw this.previewDesactualizado(
          'fingerprint divergió del cálculo vivo: re-previsualizar (D13)',
        );
      }
      this.exigirContenidoLiquidable(derivacion.resultado);
      this.exigirCobrosDisponibles(derivacion.resultado.items);

      const liquidacionId = randomUUID();
      const montos: MontosLiquidacion = {
        monto_items_centavos: derivacion.resultado.totales.monto_items_centavos,
        monto_ajustes_centavos: derivacion.resultado.totales.monto_ajustes_centavos,
        monto_total_centavos: derivacion.resultado.totales.monto_total_centavos,
        saldo_compensacion_centavos: 0, // D12/CHECK CASE: borrador siempre 0.
      };
      try {
        this.cabeceras.insert({
          id: liquidacionId,
          profesional_id: input.profesionalId,
          desde: input.desde,
          hasta: input.hasta,
          estado: 'borrador',
          ...montos,
          fingerprint: derivacion.fingerprint,
          deleted_at: null,
        });
      } catch (err: unknown) {
        if (clasificarViolacion(err) === 'cabecera') {
          throw new ComisionError({
            status: 409,
            code: 'periodo_ya_liquidado',
            message: 'conflicto de período vigente (UNIQUE parcial)',
          });
        }
        throw err;
      }
      this.insertarItems(liquidacionId, derivacion.resultado.items);
      this.insertarAjustesReservados(liquidacionId, derivacion.resultado.ajustes);
      this.eventos.insert({
        id: randomUUID(),
        liquidacion_id: liquidacionId,
        evento: 'generada',
        actor_usuario_id: input.actorUsuarioId,
        ocurrido_en: nowIsoUtc(),
      });
      return {
        liquidacion: this.obtenerCabeceraVigente(liquidacionId),
        ...this.leerFilas(liquidacionId),
      };
    });
  }

  /**
   * Regeneración (task 5.2): baja lógica de ítems + liberación de reservas
   * PROPIAS primero, re-derivación excluyendo el propio estado (D13); fp
   * divergente → 409 con rollback íntegro (bajas y liberaciones revierten).
   * Recalcula snapshot, montos y fingerprint SIN evento nuevo.
   */
  regenerarBorrador(input: RegenerarBorradorInput): BorradorPersistida {
    exigirFingerprint(input.fingerprint);
    const precheck = this.cabeceras.buscarPorIdVigente(input.liquidacionId);
    if (precheck === undefined) {
      throw this.notFound('liquidación inexistente');
    }
    if (precheck.estado !== 'borrador') {
      throw this.estadoInvalido('solo borradores aceptan regeneración (D5)');
    }
    return this.uow.runInTransaction(() => {
      const cabecera = this.obtenerCabeceraVigente(input.liquidacionId);
      if (cabecera.estado !== 'borrador') {
        throw this.estadoInvalido('solo borradores aceptan regeneración (D5)');
      }
      // Precedencia D13: liberar/baja → derivar → comparar; el ROLLBACK del
      // UnitOfWork revierte baja/liberación si el fingerprint diverge.
      this.items.darDeBajaPorLiquidacion(cabecera.id);
      this.ajustes.liberarPorLiquidacion(cabecera.id);
      const derivacion = this.derivar({
        profesionalId: cabecera.profesional_id,
        desde: cabecera.desde,
        hasta: cabecera.hasta,
        excluirBorradorId: cabecera.id,
      });
      if (derivacion.fingerprint !== input.fingerprint) {
        throw this.previewDesactualizado(
          'fingerprint divergió del cálculo vivo: re-previsualizar (D13)',
        );
      }
      this.exigirCobrosDisponibles(derivacion.resultado.items, cabecera.id);
      this.insertarItems(cabecera.id, derivacion.resultado.items);
      this.insertarAjustesReservados(cabecera.id, derivacion.resultado.ajustes);
      const montos: MontosLiquidacion = {
        monto_items_centavos: derivacion.resultado.totales.monto_items_centavos,
        monto_ajustes_centavos: derivacion.resultado.totales.monto_ajustes_centavos,
        monto_total_centavos: derivacion.resultado.totales.monto_total_centavos,
        saldo_compensacion_centavos: 0,
      };
      if (!this.cabeceras.actualizarMontos(cabecera.id, montos)) {
        throw this.estadoInvalido('estado cambió dentro de la transacción (D5)');
      }
      if (!this.cabeceras.actualizarFingerprint(cabecera.id, derivacion.fingerprint)) {
        throw this.estadoInvalido('estado cambió dentro de la transacción (D5)');
      }
      return {
        liquidacion: this.obtenerCabeceraVigente(cabecera.id),
        ...this.leerFilas(cabecera.id),
      };
    });
  }

  /**
   * Confirmación (task 5.3, D5/D12/D13): re-derivación con
   * `excluirBorradorId = self` (hash estable generar ↔ confirmar) contra el
   * fingerprint almacenado y el recibido; absorción in-order fila a fila con
   * capacidad `monto_items` (compensación parcial permitida y el resto queda
   * como arrastre pasivo, P1); transición atómica con evento `confirmada`.
   * Doble confirmación → `estado_invalido` (409).
   */
  confirmarBorrador(input: ConfirmarBorradorInput): BorradorPersistida {
    exigirFingerprint(input.fingerprint);
    if (typeof input.actorUsuarioId !== 'string' || input.actorUsuarioId === '') {
      throw errorValidacion('actor requerido');
    }
    const precheck = this.cabeceras.buscarPorIdVigente(input.liquidacionId);
    if (precheck === undefined) {
      throw this.notFound('liquidación inexistente');
    }
    if (precheck.estado !== 'borrador') {
      throw this.estadoInvalido('solo borradores aceptan confirmación (D5)');
    }
    return this.uow.runInTransaction(() => {
      const cabecera = this.obtenerCabeceraVigente(input.liquidacionId);
      if (cabecera.estado !== 'borrador') {
        throw this.estadoInvalido('solo borradores aceptan confirmación (D5)');
      }
      const derivacion = this.derivar({
        profesionalId: cabecera.profesional_id,
        desde: cabecera.desde,
        hasta: cabecera.hasta,
        excluirBorradorId: cabecera.id,
      });
      // Doble verificación D13: fingerprint recibido == almacenado == vivo.
      if (input.fingerprint !== cabecera.fingerprint) {
        throw this.previewDesactualizado(
          'el fingerprint no corresponde al borrador almacenado',
        );
      }
      if (derivacion.fingerprint !== input.fingerprint) {
        throw this.previewDesactualizado(
          'fingerprint divergió del cálculo vivo: re-previsualizar (D13)',
        );
      }
      // Guard D7: doble verificación de elegibilidad (task 5.3).
      this.exigirCobrosDisponibles(derivacion.resultado.items, cabecera.id);

      // Absorción in-order D12: capacidad = monto_items_centavos; fila a fila
      // asigna monto_compensado (0 <= compensado <= monto; la del límite puede
      // quedar parcial) y marca `consumido` + `compensado_en` incluso cuando
      // su absorción es parcial o nula — el resto queda como arrastre
      // (`listarSaldosArrastre` solo cuenta filas consumidas, P1).
      const reservadas = new Map(
        this.ajustes
          .listarReservadosPorLiquidacion(cabecera.id)
          .map((fila) => [fila.item_origen_id, fila]),
      );
      for (const ajuste of derivacion.resultado.ajustes) {
        if (!reservadas.has(ajuste.item_origen_id)) {
          throw this.previewDesactualizado(
            'las reservas de ajustes divergieron del cálculo vivo',
          );
        }
      }
      let capacidadRestante = derivacion.resultado.totales.monto_items_centavos;
      for (const ajuste of derivacion.resultado.ajustes) {
        const fila = reservadas.get(ajuste.item_origen_id)!;
        const asignado = Math.min(capacidadRestante, ajuste.monto_ajuste_centavos);
        if (
          !this.ajustes.consumir(fila.id, {
            montoCompensado: asignado,
            compensadoEn: nowIsoUtc(),
          })
        ) {
          throw this.estadoInvalido('reserva de ajuste ya no está activa (D12)');
        }
        capacidadRestante -= asignado;
      }
      // D12/P1: saldo pasivo = max(0, ajustes − items); CHECK CASE del DDL.
      const saldo = Math.max(
        0,
        derivacion.resultado.totales.monto_ajustes_centavos -
          derivacion.resultado.totales.monto_items_centavos,
      );
      const montos: MontosLiquidacion = {
        monto_items_centavos: derivacion.resultado.totales.monto_items_centavos,
        monto_ajustes_centavos: derivacion.resultado.totales.monto_ajustes_centavos,
        monto_total_centavos: derivacion.resultado.totales.monto_total_centavos,
        saldo_compensacion_centavos: saldo,
      };
      if (
        !this.cabeceras.confirmar(cabecera.id, {
          fingerprint: derivacion.fingerprint,
          montos,
        })
      ) {
        throw this.estadoInvalido('estado cambió dentro de la transacción (D5)');
      }
      this.eventos.insert({
        id: randomUUID(),
        liquidacion_id: cabecera.id,
        evento: 'confirmada',
        actor_usuario_id: input.actorUsuarioId,
        ocurrido_en: nowIsoUtc(),
      });
      return {
        liquidacion: this.obtenerCabeceraVigente(cabecera.id),
        ...this.leerFilas(cabecera.id),
      };
    });
  }

  /**
   * Detalle de consulta para `administracion` (GET /liquidaciones/:id):
   * cabecera vigente + ítems-snapshot + ajustes + eventos (R8: todo por
   * repositorios; inexistente → `404 not_found`).
   */
  obtenerDetalle(liquidacionId: string): DetalleLiquidacion {
    const liquidacion = this.obtenerCabeceraVigente(liquidacionId);
    return {
      liquidacion,
      items: this.items.listarPorLiquidacion(liquidacionId),
      ajustes: this.ajustes.listarPorLiquidacion(liquidacionId),
      eventos: this.eventos.listarPorLiquidacion(liquidacionId),
    };
  }

  /**
   * Detalle del portal (Q6 ratificada): SOLO la liquidación CONFIRMADA del
   * PROPIO profesional es visible; borradores propios y ajenas NO se exponen
   * (hoy: `undefined` → la ruta responde 404 sin montos, ocultando el id).
   * Profesional sin vínculo (`profesionalId` `undefined`) nunca ve detalles.
   */
  obtenerConfirmadaPropia(
    liquidacionId: string,
    profesionalId: string,
  ): DetalleLiquidacion | undefined {
    const fila = this.cabeceras.buscarPorIdVigente(liquidacionId);
    if (
      fila === undefined ||
      fila.estado !== 'confirmada' ||
      fila.profesional_id !== profesionalId
    ) {
      return undefined;
    }
    return {
      liquidacion: fila,
      items: this.items.listarPorLiquidacion(liquidacionId),
      ajustes: this.ajustes.listarPorLiquidacion(liquidacionId),
      eventos: this.eventos.listarPorLiquidacion(liquidacionId),
    };
  }

  /**
   * Listado del portal (GET /mis-liquidaciones, Q6): SOLO confirmadas del
   * `profesional_id` resuelto del token (scoping forzado por
   * `usuario.profesional_id`, jamás por body/query). Sin vínculo → `[]`.
   */
  listarConfirmadasDe(
    profesionalId: string | undefined,
  ): LiquidacionComisionRow[] {
    if (profesionalId === undefined) {
      return [];
    }
    return this.cabeceras.listarConfirmadasPorProfesional(profesionalId);
  }

  /** Listado de administración (GET /liquidaciones): todas las vigentes. */
  listarTodas(): LiquidacionComisionRow[] {
    return this.cabeceras.listarVigentes();
  }
}
