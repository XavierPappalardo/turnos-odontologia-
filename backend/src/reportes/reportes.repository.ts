/**
 * C-14 tasks 2.2/2.4 — `ReportesRepository`: TODO el SQL de los reportes (R8).
 *
 * Alcance read-only: ningún método escribe, ninguna migración se agrega
 * (design D1). Los métodos devuelven tipos de fila mínimos y nunca entidades
 * de dominio completas (design D8), para que la agregación viva en los
 * servicios y no se filtren datos innecesarios.
 *
 * Ventana temporal (design D4, "filtro grueso"):
 * - El repositorio NO conoce zonas horarias. Recibe `desdeUtc`/`hastaUtc` ya
 *   ensanchados con el margen de D4 (`ventanaUtcGruesa` en `periodo.ts`) y
 *   aplica `inicio >= desdeUtc AND inicio < hastaUtc` (semiabierto).
 * - El filtro fino por día local lo hace el servicio con `fechaContable`.
 *
 * Filtro de estado: `ocupacionEnVentana` aplica en SQL los cuatro estados que
 * ocupan agenda (design D3) y `resueltosEnVentana` los dos estados resueltos
 * (design D6). El servicio vuelve a verificar el estado de forma defensiva.
 *
 * Todos los valores viajan como parámetros vinculados (`?`); el único texto
 * interpolado son fragmentos constantes del propio módulo (design D12).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { PagoMedio } from '../core/models.js';
import type { TurnoEstado } from '../shared/types.js';

/** Fila mínima de turno para ocupación y ausentismo (design D8). */
export interface OcupacionFila {
  readonly profesional_id: string;
  readonly sillon_id: string;
  readonly inicio: string;
  readonly fin: string;
  readonly estado: TurnoEstado;
}

/** Filtros opcionales por dimensión (ambos se resuelven en SQL). */
export interface FiltrosTurnos {
  readonly profesionalId?: string | undefined;
  readonly sillonId?: string | undefined;
}

/**
 * Fila mínima de facturación percibida por día de aplicación y medio (design
 * D5): `movimiento_caja` aporta los montos (siempre positivos) y `pago` el
 * medio mediante JOIN. Todos los valores son enteros (R2/R5).
 */
export interface FacturacionFila {
  /** Día local `YYYY-MM-DD` en que el movimiento impacta la caja. */
  readonly aplicado_en: string;
  readonly medio: PagoMedio;
  /** Σ centavos de movimientos `cobro`. */
  readonly cobros: number;
  /** Σ centavos de movimientos `anulacion` (positivos; el neto lo deriva el servicio). */
  readonly anulaciones: number;
  readonly cobros_cantidad: number;
  readonly anulaciones_cantidad: number;
}

/** Columnas mínimas compartidas por ocupación y ausentismo (task 2.4). */
const COLUMNAS_TURNO_MINIMAS =
  'profesional_id, sillon_id, inicio, fin, estado';

/** Sólo turnos vigentes: el soft-delete queda fuera de todo reporte. */
const TURNO_VIGENTE_SQL = 'deleted_at IS NULL';

/** Estados que ocupan agenda (design D3): reservado, confirmado, presente, atendido. */
const ESTADOS_QUE_OCUPAN_SQL =
  "('reservado', 'confirmado', 'presente', 'atendido')";

/** Estados "resueltos" del denominador de ausentismo (design D6). */
const ESTADOS_RESUELTOS_SQL = "('atendido', 'ausente')";

/**
 * Neteo por tipo de movimiento (design D5, task 3.4): `movimiento_caja` es
 * append-only y las anulaciones guardan `monto_centavos` positivo, por lo que
 * el signo se aplica recién al restar en el servicio. SUM sobre INTEGER no
 * pierde precisión (R2/R5).
 */
const SUM_COBROS_SQL =
  "SUM(CASE WHEN m.tipo = 'cobro' THEN m.monto_centavos ELSE 0 END)";
const SUM_ANULACIONES_SQL =
  "SUM(CASE WHEN m.tipo = 'anulacion' THEN m.monto_centavos ELSE 0 END)";
const CONTEO_COBROS_SQL =
  "SUM(CASE WHEN m.tipo = 'cobro' THEN 1 ELSE 0 END)";
const CONTEO_ANULACIONES_SQL =
  "SUM(CASE WHEN m.tipo = 'anulacion' THEN 1 ELSE 0 END)";

export class ReportesRepository extends BaseRepository<OcupacionFila> {
  constructor(db: DatabaseSync) {
    super(db, 'turno');
  }

  /**
   * Turnos que ocupan agenda con `inicio` dentro de la ventana gruesa.
   * Orden estable (`inicio`, `id`) para tests deterministas.
   */
  ocupacionEnVentana(
    desdeUtc: string,
    hastaUtc: string,
    filtros?: FiltrosTurnos,
  ): OcupacionFila[] {
    return this.turnosEnVentana(
      ESTADOS_QUE_OCUPAN_SQL,
      desdeUtc,
      hastaUtc,
      filtros,
    );
  }

  /**
   * Turnos resueltos (`atendido` + `ausente`) con `inicio` dentro de la
   * ventana gruesa. Insumo del servicio de ausentismo (grupo 5), que necesita
   * el estado por fila para bucketing y desglose.
   */
  resueltosEnVentana(
    desdeUtc: string,
    hastaUtc: string,
    filtros?: FiltrosTurnos,
  ): OcupacionFila[] {
    return this.turnosEnVentana(
      ESTADOS_RESUELTOS_SQL,
      desdeUtc,
      hastaUtc,
      filtros,
    );
  }

  /**
   * Conteo de turnos resueltos (task 2.1). Delega en `resueltosEnVentana` para
   * no duplicar el predicado: así el conteo y las filas nunca divergen.
   */
  conteoResueltosEnVentana(
    desdeUtc: string,
    hastaUtc: string,
    filtros?: FiltrosTurnos,
  ): number {
    return this.resueltosEnVentana(desdeUtc, hastaUtc, filtros).length;
  }

  /**
   * Ingresos percibidos agrupados por `aplicado_en` y medio (design D5).
   * Se corta por `aplicado_en` (no por `fecha_contable`) para conciliar con el
   * cierre diario: un movimiento asignado a un día posterior computa allí.
   * `medio` ya debe venir validado contra el catálogo (D9).
   */
  ingresosPorAplicadoEn(
    desde: string,
    hasta: string,
    medio?: PagoMedio,
  ): FacturacionFila[] {
    const condiciones: string[] = ['m.aplicado_en BETWEEN ? AND ?'];
    const parametros: SQLInputValue[] = [desde, hasta];
    if (medio !== undefined) {
      condiciones.push('p.medio = ?');
      parametros.push(medio);
    }
    const sql = `SELECT m.aplicado_en AS aplicado_en,
                        p.medio AS medio,
                        ${SUM_COBROS_SQL} AS cobros,
                        ${SUM_ANULACIONES_SQL} AS anulaciones,
                        ${CONTEO_COBROS_SQL} AS cobros_cantidad,
                        ${CONTEO_ANULACIONES_SQL} AS anulaciones_cantidad
                   FROM movimiento_caja m
                   JOIN pago p ON p.id = m.pago_id
                  WHERE ${condiciones.join(' AND ')}
                  GROUP BY m.aplicado_en, p.medio
                  ORDER BY m.aplicado_en ASC, p.medio ASC`;
    return this.db.prepare(sql).all(...parametros) as unknown as FacturacionFila[];
  }

  /**
   * Único SELECT de turnos del módulo (task 2.4): columnas mínimas + filtro de
   * vigencia + ventana + filtros de dimensión opcionales, todo vinculado.
   */
  private turnosEnVentana(
    estadosSql: string,
    desdeUtc: string,
    hastaUtc: string,
    filtros?: FiltrosTurnos,
  ): OcupacionFila[] {
    const condiciones: string[] = [
      `estado IN ${estadosSql}`,
      TURNO_VIGENTE_SQL,
      'inicio >= ?',
      'inicio < ?',
    ];
    const parametros: SQLInputValue[] = [desdeUtc, hastaUtc];
    if (filtros?.profesionalId !== undefined) {
      condiciones.push('profesional_id = ?');
      parametros.push(filtros.profesionalId);
    }
    if (filtros?.sillonId !== undefined) {
      condiciones.push('sillon_id = ?');
      parametros.push(filtros.sillonId);
    }
    const sql = `SELECT ${COLUMNAS_TURNO_MINIMAS}
                   FROM turno
                  WHERE ${condiciones.join(' AND ')}
                  ORDER BY inicio ASC, id ASC`;
    return this.db.prepare(sql).all(...parametros) as unknown as OcupacionFila[];
  }
}
