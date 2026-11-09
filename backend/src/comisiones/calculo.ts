/**
 * Motor de cálculo puro de liquidaciones de comisiones (C-13, task 4.1; design D2/D8/D12).
 *
 * SIN EFECTOS: no accede a la base ni muta nada (D10). Los candidatos provienen
 * de `PagoRepository.listarCobrosElegiblesComision` (ya resolvieron D1/D2/Q1..Q3:
 * cobrado, medio ≠ obra_social, turno atendido, fecha contable en rango y el
 * motivo de descarte explícito). El servicio completa el contexto por
 * repositorios y pasa:
 *  - `pagosYaLiquidados`: guard `cobro_ya_liquidado` (D7 — un cobro en UNA
 *    liquidación vigente; el SQL de `liquidacionItem` ya lo impide, esto lo
 *    hace consultable en preview);
 *  - `anulacionesPendientes` / `saldosArrastre`: detección (a)/(b) de D12
 *    (ya disyunta a nivel repositorio y sin reservas activas).
 *
 * Reglas del módulo (ratificadas):
 *  - % específico por (profesional, prestación) REEMPLAZA al general, nunca se
 *    suma (RN-08); pagos por presupuesto aplican SIEMPRE general (D2/P1);
 *    turno sin prestación → general (D2).
 *  - Cada pago es un registro independiente: parciales sin consolidar (D1).
 *  - Comisión = trunc(monto × pct / 100) con aritmética entera BigInt — sin
 *    float/double NUNCA (R2), truncado hacia abajo (Q5); falla ruidosa ante
 *    montos/pcts no enteros (fail-fast R2).
 *  - Ajustes: monto > 0 (CHECK DDL); dedup defensivo por `item_origen_id`
 *    (ante detección (a)+(b) simultánea manda el arrastre: es el pendiente
 *    real de lo ya no compensado); orden de absorción determinista
 *    (`anulado_en ASC, pago_id ASC, item_origen_id ASC` — D12).
 *  - Neto = Σ items − Σ ajustes (identidad D8/D9). NUNCA produce pagos
 *    negativos automáticos: el saldo es pasivo y se arrastra (D12).
 */
import type { CobroElegibleComisionRow } from '../core/pago.repository.js';
import type { AnulacionPendienteRow, SaldoArrastreRow } from './liquidacionAjuste.repository.js';
import type { ReglaComisionAplicada, TipoAjusteComision } from '../shared/types.js';

/**
 * Config general de cálculo (D13: el fingerprint la congelará con
 * `id` + `updated_at` + `pct_general` — ver `fingerprint.ts`).
 * `ProfesionalComisionConfig` (shared/repositorio) es estructuralmente compatible.
 */
export interface ConfigGeneralCalculo {
  id: string;
  profesional_id: string;
  pct_general: number;
  updated_at: string;
}

/**
 * Config específica de cálculo (vigente por par; UNIQUE parcial del DDL).
 * `ProfesionalComisionTratamiento` es estructuralmente compatible.
 */
export interface ConfigTratamientoCalculo {
  id: string;
  profesional_id: string;
  prestacion_id: string;
  pct: number;
}

/** Ítem crudo de preview/cálculo: el servicio le sella id/created_at al insertar. */
export interface ItemCalculado {
  pago_id: string;
  turno_id: string;
  /** Snapshot D4 (`YYYY-MM-DD`) entregado por el repositorio. */
  fecha_contable: string;
  monto_cobro_centavos: number;
  pct_aplicado: number;
  regla_aplicada: ReglaComisionAplicada;
  monto_comision_centavos: number;
}

/** Motivos de descarte del motor: atribución (D1/D2) + guards de servicio (D7/D9). */
export type MotivoDescarteCalculo =
  | Exclude<CobroElegibleComisionRow['motivo_descarte'], null>
  | 'cobro_ya_liquidado'
  | 'sin_configuracion';

/** Descarte explícito y consultable: nunca exclusión silenciosa (D2/D13). */
export interface DescarteCalculo {
  pago_id: string;
  motivo: MotivoDescarteCalculo;
}

/** Ajuste pendiente listo para reservarse (D12): forma canónica de (a) y (b). */
export interface AjustePendienteCalculado {
  item_origen_id: string;
  pago_id: string;
  tipo_ajuste: TipoAjusteComision;
  monto_ajuste_centavos: number;
}

/** Σ exactas del cálculo (identidad `total = items − ajustes`, CHECK DDL). */
export interface TotalesCalculo {
  monto_items_centavos: number;
  monto_ajustes_centavos: number;
  monto_total_centavos: number;
}

export interface ContextoElegibilidad {
  /** pagos con ítem vigente en CUALQUIER liquidación (guard D7, consultable en preview). */
  pagosYaLiquidados?: readonly string[];
  /** Detección (a) D12: anulaciones de liquidaciones confirmadas sin fila de ajuste vigente. */
  anulacionesPendientes?: readonly AnulacionPendienteRow[];
  /** Detección (b) D12: restos > 0 de filas `consumido` — base del arrastre. */
  saldosArrastre?: readonly SaldoArrastreRow[];
}

export interface ResultadoCalculo {
  /** Ítems en orden canon `pago_id ASC` (estable para fingerprint D13). */
  items: ItemCalculado[];
  /** Descartes con motivo explícito, orden canon `pago_id ASC`. */
  descartes: DescarteCalculo[];
  /** Ajustes pendientes en orden de absorción (D12). */
  ajustes: AjustePendienteCalculado[];
  totales: TotalesCalculo;
}

/** Comparador lexicográfico CANÓNICO (sin locale: `localeCompare` depende del entorno). */
export function compararTextoCanonico(a: string | null, b: string | null): number {
  const va = a ?? '';
  const vb = b ?? '';
  if (va < vb) return -1;
  if (va > vb) return 1;
  return 0;
}

/**
 * Comisión truncada `floor(monto × pct / 100)` con BigInt (R2/Q5).
 * El producto excede `2^53` para montos reales grandes → un float redondearía
 * ±8 centavos; BigInt es exacto y la división entera trunca hacia abajo.
 * Un monto o pct no entero lanza (fail-fast, R2): la función es pura y no
 * normaliza datos que no puede corregir.
 */
export function truncarComision(montoCentavos: number, pct: number): number {
  return Number((BigInt(montoCentavos) * BigInt(pct)) / 100n);
}

/** Orden de absorción in-order (D12): determinista e independiente del orden de llegada. */
export function compararOrdenAbsorcion(
  a: { key: string | null; pago_id: string; item_origen_id: string },
  b: { key: string | null; pago_id: string; item_origen_id: string },
): number {
  return (
    compararTextoCanonico(a.key, b.key) ||
    compararTextoCanonico(a.pago_id, b.pago_id) ||
    compararTextoCanonico(a.item_origen_id, b.item_origen_id)
  );
}

/**
 * Cálculo puro de la liquidación (task 4.1/D8 — sin efectos, determinista):
 * insumos → ítems + descartes con motivo + ajustes pendientes + Σ exactas.
 */
export function calcularLiquidacion(args: {
  cobros: readonly CobroElegibleComisionRow[];
  configGeneral: ConfigGeneralCalculo | null;
  configsTratamiento: readonly ConfigTratamientoCalculo[];
  contexto?: ContextoElegibilidad;
}): ResultadoCalculo {
  const cobros = [...args.cobros].sort((a, b) => compararTextoCanonico(a.pago_id, b.pago_id));
  const yaLiquidados = new Set<string>(args.contexto?.pagosYaLiquidados ?? []);
  // Configs específicas canon ordenadas (prestacion_id, id): la primera es la
  // única vigente (UNIQUE parcial); el orden canónico hace determinista el
  // comportamiento ante datos degenerados.
  const tratamientos = [...args.configsTratamiento].sort(
    (a, b) =>
      compararTextoCanonico(a.prestacion_id, b.prestacion_id) ||
      compararTextoCanonico(a.id, b.id),
  );

  const items: ItemCalculado[] = [];
  const descartes: DescarteCalculo[] = [];

  for (const cobro of cobros) {
    // 1) Guard D7 prevalece: un cobro en una liquidación vigente está tomado
    //    aunque su atribución haya cambiado desde entonces (conflicto real).
    if (yaLiquidados.has(cobro.pago_id)) {
      descartes.push({ pago_id: cobro.pago_id, motivo: 'cobro_ya_liquidado' });
      continue;
    }
    // 2) Sin config general no hay % resoluble para NINGÚN cobro (las pistas
    //    de diagnóstico son idénticas; el servicio responde `sin_configuracion`).
    if (args.configGeneral === null) {
      descartes.push({ pago_id: cobro.pago_id, motivo: 'sin_configuracion' });
      continue;
    }
    // 3) Descartes de atribución resueltos por el repositorio (D1/D2/Q2) — se
    //    exponen con motivo consultable, sin recomputar la regla (R8).
    if (cobro.motivo_descarte !== null) {
      descartes.push({ pago_id: cobro.pago_id, motivo: cobro.motivo_descarte });
      continue;
    }
    // 4) Elegible: resolver el % (RN-08 / D2). La regla específica solo pone
    //    un ítem cuando existe la prestación del turno y la config pertenece
    //    al MISMO profesional de la config general (defensa de la capa pura).
    let pct: number;
    let regla: ReglaComisionAplicada;
    if (cobro.aplicacion === 'presupuesto' || cobro.prestacion_id === null) {
      pct = args.configGeneral.pct_general;
      regla = 'general';
    } else {
      const especifica = tratamientos.find(
        (t) =>
          t.profesional_id === args.configGeneral!.profesional_id &&
          t.prestacion_id === cobro.prestacion_id,
      );
      if (especifica !== undefined) {
        pct = especifica.pct;
        regla = 'tratamiento';
      } else {
        pct = args.configGeneral.pct_general;
        regla = 'general';
      }
    }
    items.push({
      pago_id: cobro.pago_id,
      // Invariante D2: motivo null implica turno atribuido (turno del pago o
      // turno del presupuesto). El cast es deliberado y documentado.
      turno_id: cobro.turno_id as string,
      fecha_contable: cobro.fecha_contable,
      monto_cobro_centavos: cobro.monto_centavos,
      pct_aplicado: pct,
      regla_aplicada: regla,
      monto_comision_centavos: truncarComision(cobro.monto_centavos, pct),
    });
  }

  // Ajustes pendientes (D12): (a) anulaciones de liquidaciones confirmadas sin
  // fila de ajuste vigente + (b) restos de filas consumido. Forma canónica,
  // monto > 0 (CHECK DDL). Se normalizan a una fila intermedia con la clave de
  // absorción y se deduplican por `item_origen_id`: si un ítem apareciera en
  // ambas detecciones, el arrastre (resto real) manda.
  interface AjusteIntermedio extends AjustePendienteCalculado {
    /** Clave de absorción: `pago.anulado_en` (a) o `MIN(anulado_en)` (b). */
    key: string | null;
  }
  const arrastresBase = (args.contexto?.saldosArrastre ?? [])
    .filter((s) => s.resto_centavos > 0)
    .map((s): AjusteIntermedio => ({
      item_origen_id: s.item_origen_id,
      pago_id: s.pago_id,
      tipo_ajuste: 'saldo_arrastre',
      monto_ajuste_centavos: s.resto_centavos,
      key: s.primer_anulado_en,
    }));
  const origenesArrastre = new Set(arrastresBase.map((a) => a.item_origen_id));
  const anulacionesBase = (args.contexto?.anulacionesPendientes ?? [])
    .filter(
      (a) =>
        a.monto_comision_original_centavos > 0 && !origenesArrastre.has(a.item_origen_id),
    )
    .map((a): AjusteIntermedio => ({
      item_origen_id: a.item_origen_id,
      pago_id: a.pago_id,
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: a.monto_comision_original_centavos,
      key: a.anulado_en,
    }));
  const ajustes: AjustePendienteCalculado[] = anulacionesBase
    .concat(arrastresBase)
    .sort(compararOrdenAbsorcion)
    .map(({ key: _key, ...ajuste }) => ajuste);

  const montoItems = items.reduce((sum, item) => sum + item.monto_comision_centavos, 0);
  const montoAjustes = ajustes.reduce((sum, ajuste) => sum + ajuste.monto_ajuste_centavos, 0);

  return {
    items,
    descartes,
    ajustes,
    totales: {
      monto_items_centavos: montoItems,
      monto_ajustes_centavos: montoAjustes,
      monto_total_centavos: montoItems - montoAjustes,
    },
  };
}
