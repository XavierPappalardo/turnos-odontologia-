/**
 * Tasks 3.1-3.5: servicios de caja (C-11).
 * Reglas de negocio de cobros multimedio (bolsillo y obra social), anulación
 * con trazabilidad, idempotencia de clave, saldos/deudas por turno y paciente,
 * cierre diario inmutable con asignación de movimientos posteriores y
 * confirmación Mercado Pago en dos etapas (firma del webhook + verificación
 * directa al proveedor, design D7).
 *
 * Toda escritura corre en `UnitOfWork.runInTransaction` (BEGIN IMMEDIATE,
 * R9/R12: SQLite real, sin mockear la capa de transacción) y todo acceso a
 * datos pasa por repositorios (R8). Los errores son `CajaError` tipados sin
 * PHI (R3): solo códigos y mensajes genéricos.
 */
import type { DatabaseSync } from 'node:sqlite';
import { PagoRepository, MEDIOS_PAGO, type CobroCaja } from '../core/pago.repository.js';
import type { PagoEstado, PagoMedio, PagoRow } from '../core/models.js';
import { TurnoRepository } from '../agenda/turno.repository.js';
import {
  PresupuestoRepository,
  type PresupuestoRow,
} from '../clinica/presupuestos.repository.js';
import { UnitOfWork, nowIsoUtc } from '../shared/repository.js';
import { CajaError } from '../shared/errors.js';
import { fechaContable as calcularFechaContable } from '../shared/fechas.js';
import type {
  CajaMovimientoId,
  CierreCajaId,
  MotivoAsignacionCaja,
  PagoId,
} from '../shared/types.js';
import {
  CajaMovimientoRepository,
  type CajaMovimientoRow,
  type TotalPorMedio,
} from './cajaMovimiento.repository.js';
import {
  CierreCajaRepository,
  type CierreCajaRow,
} from './cierreCaja.repository.js';
import {
  MpPagoInexistenteProveedorError,
  MpProveedorError,
  verificarFirmaWebhookMp,
  type MercadoPagoProveedor,
  type PagoVerificadoMp,
  type ReferenciaPagoMp,
} from './mercadopago/index.js';

/** Formato estricto de fecha contable `YYYY-MM-DD` (día, no timestamp). */
const FORMATO_FECHA = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function esFechaContableValida(fecha: string): boolean {
  return FORMATO_FECHA.test(fecha);
}

/** Suma días enteros sobre `YYYY-MM-DD` con aritmética UTC (día contable puro). */
function sumarDias(dia: string, dias: number): string {
  const partes = dia.split('-');
  const anio = Number.parseInt(partes[0] ?? '0', 10);
  const mes = Number.parseInt(partes[1] ?? '0', 10);
  const numeroDia = Number.parseInt(partes[2] ?? '0', 10);
  const ms = Date.UTC(anio, mes - 1, numeroDia + dias);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Resultado de la asignación de un movimiento (design D3). */
interface Asignacion {
  readonly aplicado_en: string;
  readonly motivo_asignacion: MotivoAsignacionCaja | null;
}

/**
 * Design D3: si la fecha contable del evento ya está cerrada, el movimiento
 * se asigna a la primera caja abierta posterior (D+1, D+2, … sin cierre)
 * conservando su `fecha_contable` original; si no existe ninguna fecha
 * abierta hasta la fecha contable actual, se rechaza con
 * `sin_caja_abierta_asignacion` (la transacción del cobro se descarta entera).
 */
function resolverAsignacion(
  cierreRepo: CierreCajaRepository,
  fechaEvento: string,
  fechaContableHoy: string,
): Asignacion {
  if (!cierreRepo.existeCierreFecha(fechaEvento)) {
    return { aplicado_en: fechaEvento, motivo_asignacion: null };
  }
  let diaPosterior = sumarDias(fechaEvento, 1);
  while (diaPosterior <= fechaContableHoy) {
    if (!cierreRepo.existeCierreFecha(diaPosterior)) {
      return { aplicado_en: diaPosterior, motivo_asignacion: 'fecha_ya_cerrada' };
    }
    diaPosterior = sumarDias(diaPosterior, 1);
  }
  throw new CajaError({
    status: 409,
    code: 'sin_caja_abierta_asignacion',
    message:
      'la fecha contable del evento ya esta cerrada y no hay caja abierta posterior para asignar el movimiento',
  });
}

/* ── Entradas ── */

export interface RegistrarCobroInput {
  /** Monto entero en centavos ARS, mayor a cero (R2/R5). */
  readonly montoCentavos: number;
  readonly medio: string;
  /** Aplicación a un concepto (presupuesto `aceptado` vigente). */
  readonly presupuestoId?: string | undefined;
  /** Aplicación directa a un turno (solo si no tiene conceptos `aceptado`). */
  readonly turnoId?: string | undefined;
  /** Clave de idempotencia opcional; si vuelve con datos distintos se rechaza. */
  readonly claveIdempotencia?: string | undefined;
  /** Referencia del medio (p. ej. últimos 4 dígitos de la transferencia). */
  readonly referencia?: string | undefined;
  /** Usuario autenticado que registra el cobro. */
  readonly actorUsuarioId: string;
  /** Override de fecha contable `YYYY-MM-DD` (carga retrasada); default: hoy en zona. */
  readonly fechaContable?: string | undefined;
}

export interface AnularPagoInput {
  readonly pagoId: string;
  readonly actorUsuarioId: string;
  /** Motivo obligatorio de la anulación (trazabilidad, spec pagos). */
  readonly motivo: string;
}

/** Entrada de confirmación MP: datos de la notificación ya recortados por la ruta. */
export interface ConfirmarPagoMpInput {
  readonly pagoId: string;
  /** `data.id` de la notificación (id del pago en el proveedor). */
  readonly paymentId: string;
  /** Header `x-signature` crudo (`ts=...,v1=...`) o undefined. */
  readonly signatureHeader: string | undefined;
  /** Header `x-request-id` o undefined. */
  readonly requestId: string | undefined;
  readonly actorUsuarioId: string;
}

/* ── Salidas (views de API, snake_case) ── */

export interface PagoView {
  readonly id: string;
  readonly monto_centavos: number;
  readonly moneda: 'ARS';
  readonly medio: string;
  readonly estado: string;
  readonly turno_id: string | null;
  readonly presupuesto_id: string | null;
  /** Referencia del medio (MP: JSON `{paymentId, externalReference}`; transferencia: últimos dígitos). */
  readonly referencia: string | null;
  readonly actor_usuario_id: string | null;
  readonly anulado_por_usuario_id: string | null;
  readonly motivo_anulacion: string | null;
  readonly anulado_en: string | null;
  readonly created_at: string;
}

export interface ResultadoCobro {
  readonly pago: PagoView;
  /** `true` cuando la clave de idempotencia devolvió el pago original. */
  readonly idempotente: boolean;
}

export interface SaldoTurnoView {
  readonly turno_id: string;
  readonly total_a_cobrar: number;
  readonly saldo_restante: number;
  readonly cobrado_ars: number;
  readonly cobrado_obra_social: number;
}

export interface ConceptoDeudaView {
  readonly presupuesto_id: string;
  readonly turno_id: string | null;
  readonly saldo_concepto_centavos: number;
  readonly pendiente_centavos: number;
}

export interface DeudaPacienteView {
  readonly paciente_id: string;
  readonly deuda_total_centavos: number;
  readonly conceptos: readonly ConceptoDeudaView[];
}

export interface ResumenDiaView {
  readonly fecha: string;
  readonly por_medio: {
    readonly efectivo: number;
    readonly tarjeta: number;
    readonly transferencia: number;
    readonly mercadopago: number;
    readonly obra_social: number;
  };
  /** Ingreso de bolsillo (todos los medios menos obra social), neto de anulaciones. */
  readonly cobrado_ars: number;
  /** Ingreso real de obra social, separado de la deuda del paciente. */
  readonly cobrado_obra_social: number;
  readonly anulaciones: {
    readonly cantidad: number;
    readonly centavos: number;
  };
}

export interface MovimientoCajaView {
  readonly id: string;
  readonly pago_id: string;
  readonly tipo: 'cobro' | 'anulacion';
  readonly monto_centavos: number;
  readonly moneda: 'ARS';
  readonly actor_usuario_id: string;
  readonly fecha_contable: string;
  readonly aplicado_en: string;
  readonly motivo_asignacion: MotivoAsignacionCaja | null;
  readonly created_at: string;
}

/* ── Opciones de integración ── */

export interface MercadoPagoCajaOptions {
  /** Adaptador del proveedor (en tests: fake en el límite de la interfaz, R12). */
  readonly proveedor: MercadoPagoProveedor;
  /** Secreto `MP_WEBHOOK_SECRET` para la firma de notificaciones (R15). */
  readonly webhookSecret: string;
}

export interface CajaServiceOptions {
  /** Zona horaria IANA ya validada por `loadConfig` (design D11). */
  readonly zonaHoraria: string;
  /** Ausente → cobros MP y confirmaciones responden `503 mp_no_configurado`. */
  readonly mercadopago?: MercadoPagoCajaOptions | undefined;
}

/* ── Servicio ── */

export class CajaService {
  private readonly pagos: PagoRepository;
  private readonly movimientos: CajaMovimientoRepository;
  private readonly cierres: CierreCajaRepository;
  private readonly presupuestos: PresupuestoRepository;
  private readonly turnos: TurnoRepository;
  private readonly uow: UnitOfWork;
  private readonly zonaHoraria: string;
  private readonly mp: MercadoPagoCajaOptions | undefined;

  constructor(db: DatabaseSync, options: CajaServiceOptions) {
    this.pagos = new PagoRepository(db);
    this.movimientos = new CajaMovimientoRepository(db);
    this.cierres = new CierreCajaRepository(db);
    this.presupuestos = new PresupuestoRepository(db);
    this.turnos = new TurnoRepository(db);
    this.uow = new UnitOfWork(db);
    this.zonaHoraria = options.zonaHoraria;
    this.mp = options.mercadopago;
  }

  /* ── Mapeos y errores tipados ── */

  private viewDePago(row: PagoRow): PagoView {
    return {
      id: row.id,
      monto_centavos: row.monto_centavos,
      moneda: 'ARS',
      medio: row.medio,
      estado: row.estado,
      turno_id: row.turno_id ?? null,
      presupuesto_id: row.presupuesto_id ?? null,
      referencia: row.referencia ?? null,
      actor_usuario_id: row.actor_usuario_id ?? null,
      anulado_por_usuario_id: row.anulado_por_usuario_id ?? null,
      motivo_anulacion: row.motivo_anulacion ?? null,
      anulado_en: row.anulado_en ?? null,
      created_at: row.created_at,
    };
  }

  private viewDeMovimiento(row: CajaMovimientoRow): MovimientoCajaView {
    return {
      id: row.id,
      pago_id: row.pago_id,
      tipo: row.tipo,
      monto_centavos: row.monto_centavos,
      moneda: 'ARS',
      actor_usuario_id: row.actor_usuario_id,
      fecha_contable: row.fecha_contable,
      aplicado_en: row.aplicado_en,
      motivo_asignacion: row.motivo_asignacion,
      created_at: row.created_at,
    };
  }

  private errorValidacion(detalle: string): CajaError {
    return new CajaError({
      status: 400,
      code: 'validacion',
      message: 'la solicitud de caja no cumple las reglas de validacion',
      detalle,
    });
  }

  private errorNoEncontrado(recurso: string): CajaError {
    return new CajaError({
      status: 404,
      code: 'not_found',
      message: `el recurso solicitado no existe: ${recurso}`,
    });
  }

  private errorProveedorMp(): CajaError {
    return new CajaError({
      status: 502,
      code: 'mp_error_proveedor',
      message: 'el proveedor de pagos no pudo ser consultado',
    });
  }

  private errorMpNoConfigurado(): CajaError {
    return new CajaError({
      status: 503,
      code: 'mp_no_configurado',
      message: 'la integracion con Mercado Pago no esta configurada',
    });
  }

  /* ── Conceptos, idempotencia y asignación ── */

  /** Conceptos (presupuestos) `aceptado` vigentes del turno. */
  private listarConceptosAceptados(turnoId: string): PresupuestoRow[] {
    return this.presupuestos
      .listarPorTurno(turnoId)
      .filter(
        (p) => p.estado === 'aceptado' && (p.deleted_at ?? null) === null,
      );
  }

  /** ¿El reenvío con la misma clave coincide en aplicación + medio + monto? */
  private mismoPayload(
    existente: PagoRow,
    monto: number,
    medio: PagoMedio,
    presupuestoId: string | null,
    turnoId: string | null,
  ): boolean {
    const mismaAplicacion =
      (existente.presupuesto_id ?? null) === presupuestoId &&
      (presupuestoId !== null || (existente.turno_id ?? null) === (turnoId ?? null));
    return (
      mismaAplicacion &&
      existente.medio === medio &&
      existente.monto_centavos === monto
    );
  }

  private mapeoMedios(totales: readonly TotalPorMedio[]): Map<string, number> {
    const mapa = new Map<string, number>();
    for (const item of totales) {
      mapa.set(item.medio, item.total);
    }
    return mapa;
  }

  /**
   * Netos por medio de una fecha asignada: cobros menos anulaciones del mismo
   * medio (ejemplo de la spec: tarjeta 800000 cobrado + 200000 anulado →
   * 600000). El piso en 0 evita violar los CHECK `>= 0` del snapshot cuando
   * una anulación asignada supera los cobros del medio en esa caja.
   */
  private totalesNetosPorMedio(fecha: string): {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    mercadopago: number;
    obra_social: number;
  } {
    const cobros = this.mapeoMedios(this.movimientos.totalesCobroPorMedio(fecha));
    const anulados = this.mapeoMedios(
      this.movimientos.totalesAnulacionPorMedio(fecha),
    );
    const neto = (medio: string): number => {
      const bruto = cobros.get(medio) ?? 0;
      const anulado = anulados.get(medio) ?? 0;
      return Math.max(0, bruto - anulado);
    };
    return {
      efectivo: neto('efectivo'),
      tarjeta: neto('tarjeta'),
      transferencia: neto('transferencia'),
      mercadopago: neto('mercadopago'),
      obra_social: neto('obra_social'),
    };
  }

  /* ── Task 3.1: registrar cobro ── */

  registrarCobro(input: RegistrarCobroInput): ResultadoCobro {
    return this.uow.runInTransaction(() => this.registrarCobroInterno(input));
  }

  private registrarCobroInterno(input: RegistrarCobroInput): ResultadoCobro {
    // 1) monto exacto en centavos: entero seguro y mayor a cero (R2/R5).
    if (!Number.isSafeInteger(input.montoCentavos) || input.montoCentavos <= 0) {
      throw this.errorValidacion(
        'monto_centavos debe ser un entero en centavos mayor a cero',
      );
    }
    // 2) medio del catálogo.
    if (!(MEDIOS_PAGO as readonly string[]).includes(input.medio)) {
      throw this.errorValidacion('medio fuera del catalogo de medios de pago');
    }
    const medio = input.medio as PagoMedio;

    // 3) integración Mercado Pago disponible (503 sin tocar base, D7).
    const mp = this.mp;
    if (medio === 'mercadopago' && mp === undefined) {
      throw this.errorMpNoConfigurado();
    }

    // 4) aplicación obligatoria y coherente (concepto `aceptado` o turno).
    const presupuestoId = input.presupuestoId ?? null;
    const turnoIdInput = input.turnoId ?? null;
    if (presupuestoId === null && turnoIdInput === null) {
      throw this.errorValidacion('todo cobro requiere presupuesto_id o turno_id');
    }
    let turnoVinculado: string | null = null;
    let concepto: PresupuestoRow | null = null;
    if (presupuestoId !== null) {
      const row = this.presupuestos.findById(presupuestoId);
      if (row === undefined || (row.deleted_at ?? null) !== null) {
        throw this.errorValidacion('el presupuesto indicado no existe');
      }
      if (row.estado !== 'aceptado') {
        throw new CajaError({
          status: 422,
          code: 'aplicacion_requerida',
          message: 'el presupuesto indicado no esta en estado aceptado',
        });
      }
      if (turnoIdInput !== null && turnoIdInput !== row.turno_id) {
        throw this.errorValidacion('turno_id no coincide con el turno del presupuesto');
      }
      concepto = row;
      turnoVinculado = row.turno_id;
    } else {
      // Cobro directo por turno: exige turno existente y sin conceptos
      // `aceptado` (aplicarlos "libre" contabilizaría el concepto dos veces).
      if (turnoIdInput === null) {
        throw this.errorValidacion('todo cobro requiere presupuesto_id o turno_id');
      }
      const turnoRow = this.turnos.findById(turnoIdInput);
      if (turnoRow === undefined) {
        throw this.errorValidacion('el turno indicado no existe');
      }
      if (this.listarConceptosAceptados(turnoIdInput).length > 0) {
        throw new CajaError({
          status: 422,
          code: 'aplicacion_requerida',
          message:
            'el turno tiene presupuestos aceptado: el cobro debe aplicar a un presupuesto',
        });
      }
      if (medio === 'obra_social') {
        throw new CajaError({
          status: 422,
          code: 'aplicacion_requerida',
          message: 'el cobro a obra social debe aplicar a un presupuesto',
        });
      }
      turnoVinculado = turnoIdInput;
    }

    // 5) idempotencia ANTES de los topes: el reenvío idéntico de un cobro que
    //    ya cubrió el concepto devuelve el pago original (spec pagos).
    const clave = input.claveIdempotencia ?? null;
    if (clave !== null && clave !== '') {
      const existente = this.pagos.buscarPorClaveIdempotencia(clave);
      if (existente !== undefined) {
        if (
          !this.mismoPayload(
            existente,
            input.montoCentavos,
            medio,
            presupuestoId,
            turnoIdInput,
          )
        ) {
          throw new CajaError({
            status: 409,
            code: 'idempotencia_conflictos',
            message: 'la clave de idempotencia ya fue usada con datos distintos',
          });
        }
        return { pago: this.viewDePago(existente), idempotente: true };
      }
    }

    // 6) tope por concepto (bolsillo): parciales permitidos hasta agotar.
    if (concepto !== null && medio !== 'obra_social') {
      const cobradoBolsillo = this.pagos.cobroBolsilloPorConcepto(concepto.id);
      const pendiente = concepto.saldo_centavos - cobradoBolsillo;
      if (input.montoCentavos > pendiente) {
        throw new CajaError({
          status: 422,
          code: 'monto_excede_saldo',
          message: 'el monto excede el saldo pendiente del concepto',
        });
      }
    }
    // 7) guard de obra social: cobertura acumulativa restante del concepto
    //    (las anulaciones devuelven lo usado; chequeo y registro en la misma
    //    transacción). El cobro OS nunca reduce el saldo del paciente.
    if (concepto !== null && medio === 'obra_social') {
      const usadosOs = this.pagos.cobroObraSocialPorConcepto(concepto.id);
      if (usadosOs + input.montoCentavos > concepto.cobertura_centavos) {
        throw new CajaError({
          status: 422,
          code: 'cobro_os_excede_cobertura',
          message:
            'el cobro a obra social excede la cobertura restante del concepto',
        });
      }
    }

    // 8) fecha contable del evento + asignación si el día ya está cerrado
    //    (409 sin_caja_abierta_asignacion descarta la transacción entera).
    const ahoraIso = nowIsoUtc();
    const hoyContable = calcularFechaContable(ahoraIso, this.zonaHoraria);
    const fechaEvento = input.fechaContable ?? hoyContable;
    if (!esFechaContableValida(fechaEvento)) {
      throw this.errorValidacion('la fecha contable debe tener formato YYYY-MM-DD');
    }
    const asignacion = resolverAsignacion(this.cierres, fechaEvento, hoyContable);

    // 9) pago + referencia; Mercado Pago queda `pendiente` SIN movimiento de
    //    caja: el movimiento se crea al confirmar (design D7).
    const pagoId = crypto.randomUUID();
    const esMpPendiente = medio === 'mercadopago';
    let referencia: string | null = input.referencia ?? null;
    if (esMpPendiente) {
      if (mp === undefined) {
        // Defensivo: el paso 3 ya rechazó este caso antes de tocar base.
        throw this.errorMpNoConfigurado();
      }
      let ref: ReferenciaPagoMp;
      try {
        ref = mp.proveedor.crearIntencion({
          pagoId,
          montoCentavos: input.montoCentavos,
        });
      } catch (err) {
        if (err instanceof MpProveedorError) {
          throw this.errorProveedorMp();
        }
        throw err;
      }
      referencia = JSON.stringify(ref);
    }
    const estadoInicial: PagoEstado = esMpPendiente ? 'pendiente' : 'cobrado';
    const entrada: CobroCaja = {
      id: pagoId,
      montoCentavos: input.montoCentavos,
      medio,
      estado: estadoInicial,
      turnoId: turnoVinculado,
      presupuestoId,
      claveIdempotencia: clave,
      referencia,
      actorUsuarioId: input.actorUsuarioId,
    };
    this.pagos.cobrar(entrada);

    // 10) movimiento de caja trazable, creado atómicamente con el pago.
    if (!esMpPendiente) {
      this.movimientos.insertar({
        id: crypto.randomUUID() as CajaMovimientoId,
        pagoId: pagoId as PagoId,
        tipo: 'cobro',
        montoCentavos: input.montoCentavos,
        actorUsuarioId: input.actorUsuarioId,
        fechaContable: fechaEvento,
        aplicadoEn: asignacion.aplicado_en,
        motivoAsignacion: asignacion.motivo_asignacion,
      });
    }

    const creado = this.pagos.findById(pagoId);
    if (creado === undefined) {
      throw new Error('pago no encontrado tras insertar');
    }
    return { pago: this.viewDePago(creado), idempotente: false };
  }

  /* ── Task 3.2: anulación con trazabilidad ── */

  anularPago(input: AnularPagoInput): PagoView {
    return this.uow.runInTransaction(() => {
      const motivo = input.motivo.trim();
      if (motivo === '') {
        throw this.errorValidacion('el motivo de anulacion es obligatorio');
      }
      // Relectura dentro de la transacción (BEGIN IMMEDIATE): carreras fuera.
      const pago = this.pagos.findById(input.pagoId);
      if (pago === undefined || (pago.deleted_at ?? null) !== null) {
        throw this.errorNoEncontrado('pago');
      }
      if (pago.estado !== 'cobrado') {
        throw new CajaError({
          status: 409,
          code: 'anulacion_inconsistente',
          message: 'solo un pago en estado cobrado puede anularse',
        });
      }
      const aplicada = this.pagos.anular(pago.id, {
        anuladoPorUsuarioId: input.actorUsuarioId,
        motivo,
      });
      if (!aplicada) {
        throw new CajaError({
          status: 409,
          code: 'anulacion_inconsistente',
          message: 'el pago ya no esta en estado cobrado',
        });
      }
      // El movimiento de anulación sigue la misma regla de asignación que los
      // cobros (día cerrado → caja abierta siguiente; sin caja, se descarta).
      const ahoraIso = nowIsoUtc();
      const hoyContable = calcularFechaContable(ahoraIso, this.zonaHoraria);
      const asignacion = resolverAsignacion(this.cierres, hoyContable, hoyContable);
      this.movimientos.insertar({
        id: crypto.randomUUID() as CajaMovimientoId,
        pagoId: pago.id as PagoId,
        tipo: 'anulacion',
        montoCentavos: pago.monto_centavos,
        actorUsuarioId: input.actorUsuarioId,
        fechaContable: hoyContable,
        aplicadoEn: asignacion.aplicado_en,
        motivoAsignacion: asignacion.motivo_asignacion,
      });
      const actualizado = this.pagos.findById(pago.id);
      if (actualizado === undefined) {
        throw new Error('pago no encontrado tras anular');
      }
      return this.viewDePago(actualizado);
    });
  }

  /* ── Task 3.2/4.1: confirmación MP en dos etapas ── */

  confirmarPagoMp(input: ConfirmarPagoMpInput): PagoView {
    const mp = this.mp;
    if (mp === undefined) {
      throw this.errorMpNoConfigurado();
    }
    // Etapa 0: vínculo local (404 sin consultar proveedor, sin cambiar estado).
    const pagoLocal = this.pagos.findById(input.pagoId);
    if (pagoLocal === undefined || (pagoLocal.deleted_at ?? null) !== null) {
      throw new CajaError({
        status: 404,
        code: 'mp_pago_inexistente',
        message: 'no existe un pago local con el identificador indicado',
      });
    }
    const link = this.leerReferenciaMp(pagoLocal.referencia ?? null);
    if (link === undefined || link.paymentId !== input.paymentId) {
      throw new CajaError({
        status: 404,
        code: 'mp_pago_inexistente',
        message: 'el pago local no esta vinculado a la notificacion recibida',
      });
    }
    // Etapa 1: firma del webhook (manifest oficial, HMAC-SHA256, tiempo
    // constante). Sin firma válida no se continúa: nada consulta al proveedor.
    const firmaValida = verificarFirmaWebhookMp({
      signatureHeader: input.signatureHeader,
      requestId: input.requestId,
      paymentId: input.paymentId,
      secreto: mp.webhookSecret,
    });
    if (!firmaValida) {
      throw new CajaError({
        status: 401,
        code: 'mp_firma_invalida',
        message: 'la firma de la notificacion no es valida',
      });
    }
    // Etapa 2: verificación directa `GET /v1/payments/{id}` con el Bearer del
    // servidor y contraste exacto contra el registro local (R2).
    let verificado: PagoVerificadoMp;
    try {
      verificado = mp.proveedor.consultarPago(input.paymentId);
    } catch (err) {
      if (err instanceof MpPagoInexistenteProveedorError) {
        throw new CajaError({
          status: 422,
          code: 'mp_pago_no_verificado',
          message: 'el pago no se pudo verificar en el proveedor',
        });
      }
      if (err instanceof MpProveedorError) {
        throw this.errorProveedorMp();
      }
      throw err;
    }
    if (verificado.estado !== 'approved') {
      throw new CajaError({
        status: 422,
        code: 'mp_pago_no_aprobado',
        message: 'el pago en el proveedor no esta aprobado',
      });
    }
    if (
      verificado.montoCentavos !== pagoLocal.monto_centavos ||
      verificado.moneda !== 'ARS' ||
      verificado.externalReference !== link.externalReference
    ) {
      throw new CajaError({
        status: 422,
        code: 'mp_datos_incongruentes',
        message: 'los datos del proveedor no coinciden con el registro local',
      });
    }
    // Transición con relectura dentro de UnitOfWork (BEGIN IMMEDIATE):
    // pendiente → cobrado (+ movimiento); cobrado → 200 idempotente sin doble
    // movimiento; anulado → 409 transición inválida.
    return this.uow.runInTransaction(() => {
      const vigente = this.pagos.findById(input.pagoId);
      if (vigente === undefined) {
        throw new CajaError({
          status: 404,
          code: 'mp_pago_inexistente',
          message: 'no existe un pago local con el identificador indicado',
        });
      }
      if (vigente.estado === 'pendiente') {
        const aplicada = this.pagos.marcarCobrado(vigente.id);
        if (!aplicada) {
          throw new CajaError({
            status: 409,
            code: 'mp_transicion_invalida',
            message: 'el pago ya no esta en estado pendiente',
          });
        }
        const ahoraIso = nowIsoUtc();
        const hoyContable = calcularFechaContable(ahoraIso, this.zonaHoraria);
        const asignacion = resolverAsignacion(this.cierres, hoyContable, hoyContable);
        this.movimientos.insertar({
          id: crypto.randomUUID() as CajaMovimientoId,
          pagoId: vigente.id as PagoId,
          tipo: 'cobro',
          montoCentavos: vigente.monto_centavos,
          actorUsuarioId: input.actorUsuarioId,
          fechaContable: hoyContable,
          aplicadoEn: asignacion.aplicado_en,
          motivoAsignacion: asignacion.motivo_asignacion,
        });
      } else if (vigente.estado === 'anulado') {
        throw new CajaError({
          status: 409,
          code: 'mp_transicion_invalida',
          message: 'el pago esta anulado y no puede confirmarse',
        });
      }
      const actualizado = this.pagos.findById(vigente.id);
      if (actualizado === undefined) {
        throw new Error('pago no encontrado tras confirmar');
      }
      return this.viewDePago(actualizado);
    });
  }

  /** Extrae la referencia MP estructurada de `pago.referencia` (JSON) o undefined. */
  private leerReferenciaMp(
    referencia: string | null,
  ): ReferenciaPagoMp | undefined {
    if (referencia === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(referencia);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const registro = parsed as Record<string, unknown>;
      const paymentId = registro['paymentId'];
      const externalReference = registro['externalReference'];
      if (typeof paymentId !== 'string' || typeof externalReference !== 'string') {
        return undefined;
      }
      return { paymentId, externalReference };
    } catch {
      return undefined;
    }
  }

  /* ── Task 3.3: consultas de saldos, deudas e historiales ── */

  saldoPorTurno(turnoId: string): SaldoTurnoView {
    if (this.turnos.findById(turnoId) === undefined) {
      throw this.errorNoEncontrado('turno');
    }
    const conceptos = this.listarConceptosAceptados(turnoId);
    let totalACobrar = 0;
    let saldoRestante = 0;
    for (const concepto of conceptos) {
      totalACobrar += concepto.saldo_centavos;
      // `saldo_centavos` del presupuesto no se edita al cobrar; el pendiente
      // es el saldo menos los cobros de bolsillo vigentes del concepto.
      const cobradoBolsillo = this.pagos.cobroBolsilloPorConcepto(concepto.id);
      saldoRestante += concepto.saldo_centavos - cobradoBolsillo;
    }
    return {
      turno_id: turnoId,
      total_a_cobrar: totalACobrar,
      saldo_restante: saldoRestante,
      cobrado_ars: this.pagos.cobroBolsilloPorTurno(turnoId),
      cobrado_obra_social: this.pagos.cobroObraSocialPorTurno(turnoId),
    };
  }

  deudaPorPaciente(pacienteId: string): DeudaPacienteView {
    // Deuda ARS = Σ pendiente por concepto (bolsillo) de todos los conceptos
    // `aceptado` vigentes, incluidos presupuestos sin turno; cada concepto una
    // vez. Un paciente sin conceptos vigentes devuelve deuda 0 (no inventa).
    const conceptos = this.presupuestos.listarAceptadosPorPaciente(pacienteId);
    const conceptoViews: ConceptoDeudaView[] = conceptos.map((concepto) => {
      const cobradoBolsillo = this.pagos.cobroBolsilloPorConcepto(concepto.id);
      return {
        presupuesto_id: concepto.id,
        turno_id: concepto.turno_id,
        saldo_concepto_centavos: concepto.saldo_centavos,
        pendiente_centavos: concepto.saldo_centavos - cobradoBolsillo,
      };
    });
    const deudaTotal = conceptoViews.reduce(
      (total, concepto) => total + concepto.pendiente_centavos,
      0,
    );
    return {
      paciente_id: pacienteId,
      deuda_total_centavos: deudaTotal,
      conceptos: conceptoViews,
    };
  }

  /** Historial del turno: cobros aplicados a sus conceptos, directos y anulados. */
  historialPorTurno(turnoId: string): PagoView[] {
    if (this.turnos.findById(turnoId) === undefined) {
      throw this.errorNoEncontrado('turno');
    }
    return this.pagos.listarPorTurno(turnoId).map((row) => this.viewDePago(row));
  }

  /** Historial por concepto, incluidos los anulados marcados con actor/motivo. */
  historialPorConcepto(presupuestoId: string): PagoView[] {
    const concepto = this.presupuestos.findById(presupuestoId);
    if (concepto === undefined || (concepto.deleted_at ?? null) !== null) {
      throw this.errorNoEncontrado('presupuesto');
    }
    return this.pagos
      .listarPorPresupuesto(presupuestoId)
      .map((row) => this.viewDePago(row));
  }

  /* ── Task 3.5: cierre diario ── */

  cerrarCaja(input: { actorUsuarioId: string }): CierreCajaRow {
    return this.uow.runInTransaction(() => {
      const ahoraIso = nowIsoUtc();
      const fecha = calcularFechaContable(ahoraIso, this.zonaHoraria);
      // Doble defensa: check-then-insert en BEGIN IMMEDIATE + UNIQUE(fecha).
      if (this.cierres.existeCierreFecha(fecha)) {
        throw new CajaError({
          status: 409,
          code: 'cierre_duplicado',
          message: 'la caja de esta fecha contable ya esta cerrada',
        });
      }
      // Snapshot del día calculado SOLO por `aplicado_en` (los movimientos
      // asignados desde otra fecha contable computan aquí, no en la suya).
      const netoPorMedio = this.totalesNetosPorMedio(fecha);
      const anulaciones = this.movimientos
        .listarPorFechaAplicada(fecha)
        .filter((m) => m.tipo === 'anulacion');
      const anulacionesCentavos = anulaciones.reduce(
        (total, m) => total + m.monto_centavos,
        0,
      );
      const cierreId = crypto.randomUUID() as CierreCajaId;
      this.cierres.insertar({
        id: cierreId,
        fecha,
        zonaHoraria: this.zonaHoraria,
        totalEfectivoCentavos: netoPorMedio.efectivo,
        totalTarjetaCentavos: netoPorMedio.tarjeta,
        totalTransferenciaCentavos: netoPorMedio.transferencia,
        totalMercadopagoCentavos: netoPorMedio.mercadopago,
        totalObraSocialCentavos: netoPorMedio.obra_social,
        anulacionesCantidad: anulaciones.length,
        anulacionesCentavos,
        actorUsuarioId: input.actorUsuarioId,
        cerradoEn: ahoraIso,
      });
      const insertado = this.cierres.buscarPorFecha(fecha);
      if (insertado === undefined) {
        throw new Error('cierre no encontrado tras insertar');
      }
      return insertado;
    });
  }

  /** Resumen de una fecha asignada: por medio, bolsillo vs OS, anulaciones aparte. */
  resumenPorDia(fecha: string): ResumenDiaView {
    if (!esFechaContableValida(fecha)) {
      throw this.errorValidacion('la fecha debe tener formato YYYY-MM-DD');
    }
    const netoPorMedio = this.totalesNetosPorMedio(fecha);
    const anulaciones = this.movimientos
      .listarPorFechaAplicada(fecha)
      .filter((m) => m.tipo === 'anulacion');
    const anulacionesCentavos = anulaciones.reduce(
      (total, m) => total + m.monto_centavos,
      0,
    );
    const cobradoArs =
      netoPorMedio.efectivo +
      netoPorMedio.tarjeta +
      netoPorMedio.transferencia +
      netoPorMedio.mercadopago;
    return {
      fecha,
      por_medio: netoPorMedio,
      cobrado_ars: cobradoArs,
      cobrado_obra_social: netoPorMedio.obra_social,
      anulaciones: {
        cantidad: anulaciones.length,
        centavos: anulacionesCentavos,
      },
    };
  }

  /** Historial de cierres, del más reciente al más antiguo (fechas no cerradas no aparecen). */
  historialCierres(): CierreCajaRow[] {
    return this.cierres.listarCierres();
  }

  /** Movimientos asignados a una fecha contable, con actor/fecha/motivo de asignación. */
  movimientosPorFecha(fecha: string): MovimientoCajaView[] {
    if (!esFechaContableValida(fecha)) {
      throw this.errorValidacion('la fecha debe tener formato YYYY-MM-DD');
    }
    return this.movimientos
      .listarPorFechaAplicada(fecha)
      .map((row) => this.viewDeMovimiento(row));
  }
}
