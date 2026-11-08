/**
 * Fingerprint SHA-256 del cálculo de comisiones (C-13, task 4.3; design D13).
 *
 * Función PURA (sin efectos): serializa canónicamente los insumos que
 * determinan el resultado y hashea con SHA-256 (`node:crypto`). Sin
 * timestamps de ejecución ni valores aleatorios en la semilla; los únicos
 * timestamps son los de auditoría de la config vigente que D13 exige.
 *
 * Cobertura (D13 + "datos que afectan directamente al resultado"):
 *  - {profesional_id, desde, hasta}.
 *  - Config general vigente: EXACTAMENTE {id, updated_at, pct_general} (D13).
 *  - Tratamientos: {prestacion_id, pct}, orden canon por `prestacion_id`
 *    (id/updated_at no cambian el resultado: re-crear la config con el mismo
 *    pct NO debe invalidar una preview; solo el % importa al cálculo).
 *  - Cobros elegibles (motivo null): snapshot completo por pago
 *    {pago_id, monto_centavos, medio, fecha_contable, turno_id, prestacion_id,
 *    aplicacion}, orden canon por `pago_id`. Cada pago es un registro
 *    independiente (D1); turno/prestación/aplicación deciden el % (D2/RN-08),
 *    así que cualquier cambio relevante de atribución → hash distinto. Los
 *    descartados NO entran: sus motivos son metadata consultable, y un cobro
 *    que pasa de elegible a descartado (o viceversa) altera el conjunto.
 *  - Ajustes pendientes: {pago_id, item_origen_id, tipo_ajuste,
 *    monto_ajuste_centavos}, orden canon (pago_id, item_origen_id,
 *    monto, tipo_ajuste). Los `reservados` por otro borrador quedan fuera
 *    (excluidos upstream por la detección (a)/(b), P2/D12): la reserva ajena
 *    cambia el conjunto vivo → hash distinto, sin silencios.
 *  - Cobros ya capturados por un borrador ajeno (guard D7): lista canon de
 *    `pago_id` entre los candidatos elegibles del período (D13/P2 — la
 *    disponibilidad del cobro derrite el resultado). Sin esta semilla, el
 *    perdedor de una generación concurrente compondría el MISMO hash con los
 *    ítems ya capturados y chocaría la UNIQUE en insert en lugar de recibir
 *    `409 preview_desactualizado` (comportamiento exigido por spec P2).
 *
 * Canonicidad: comparadores lexicográficos SIN locale (`localeCompare`
 * depende del entorno), claves de objeto en orden fijo de inserción y
 * `JSON.stringify` sobre enteros seguros (R2). Mismo input lógico → mismo
 * hash en cualquier orden de llegada de los arrays.
 */
import { createHash } from 'node:crypto';
import type { CobroElegibleComisionRow } from '../core/pago.repository.js';
import type {
  AjustePendienteCalculado,
  ConfigGeneralCalculo,
  ConfigTratamientoCalculo,
} from './calculo.js';
import { compararTextoCanonico as comparar } from './calculo.js';

export interface EntradaFingerprintComision {
  profesional_id: string;
  desde: string;
  hasta: string;
  config_general: ConfigGeneralCalculo | null;
  tratamientos: readonly ConfigTratamientoCalculo[];
  cobros: readonly CobroElegibleComisionRow[];
  ajustes_pendientes: readonly AjustePendienteCalculado[];
  /**
   * `pago_id` de los candidatos ELEGIBLES que ya figuran como ítem vigente en
   * CUALQUIER liquidación (captura ajena, guard D7). Canon ordenado.
   * Opcional (default `[]`): omitir equivale a lista vacía, así las entradas
   * antiguas mantienen el mismo hash.
   */
  pagos_ya_liquidados?: readonly string[];
}

/** Ajuste reducido a los campos de D13 (+ tipo, semántica del ajuste). */
interface AjusteCanonico {
  pago_id: string;
  item_origen_id: string;
  tipo_ajuste: AjustePendienteCalculado['tipo_ajuste'];
  monto_ajuste_centavos: number;
}

/**
 * Fingerprint canónico del cálculo (hex lowercase, 64 chars).
 * Determinista: sin efectos, sin estado global; re-evaluable dentro de la
 * transacción del servicio como doble verificación (D13, patrón F1).
 */
export function calcularFingerprint(entrada: EntradaFingerprintComision): string {
  const semilla = {
    profesional_id: entrada.profesional_id,
    desde: entrada.desde,
    hasta: entrada.hasta,
    config_general:
      entrada.config_general === null
        ? null
        : {
            id: entrada.config_general.id,
            updated_at: entrada.config_general.updated_at,
            pct_general: entrada.config_general.pct_general,
          },
    tratamientos: [...entrada.tratamientos]
      .sort((a, b) => comparar(a.prestacion_id, b.prestacion_id))
      .map((t) => ({ prestacion_id: t.prestacion_id, pct: t.pct })),
    cobros: [...entrada.cobros]
      .filter((c) => c.motivo_descarte === null)
      .sort((a, b) => comparar(a.pago_id, b.pago_id))
      .map((c) => ({
        pago_id: c.pago_id,
        monto_centavos: c.monto_centavos,
        medio: c.medio,
        fecha_contable: c.fecha_contable,
        turno_id: c.turno_id,
        prestacion_id: c.prestacion_id,
        aplicacion: c.aplicacion,
      })),
    ajustes: [...entrada.ajustes_pendientes]
      .map((a): AjusteCanonico => ({
        pago_id: a.pago_id,
        item_origen_id: a.item_origen_id,
        tipo_ajuste: a.tipo_ajuste,
        monto_ajuste_centavos: a.monto_ajuste_centavos,
      }))
      .sort(
        (a, b) =>
          comparar(a.pago_id, b.pago_id) ||
          comparar(a.item_origen_id, b.item_origen_id) ||
          (a.monto_ajuste_centavos - b.monto_ajuste_centavos) ||
          comparar(a.tipo_ajuste, b.tipo_ajuste),
      ),
    pagos_ya_liquidados: [...(entrada.pagos_ya_liquidados ?? [])].sort(comparar),
  };
  return createHash('sha256').update(JSON.stringify(semilla), 'utf8').digest('hex');
}
