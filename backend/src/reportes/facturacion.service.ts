/**
 * C-14 task 6.2/6.4 — `facturacion.service.ts`: facturación PERCIBIDA.
 *
 * Contrato (design D5/D7): los ingresos se calculan sobre `movimiento_caja`
 * agrupado por `aplicado_en` (`YYYY-MM-DD` local, ya persistido en la base) y
 * neteados con las anulaciones, que se guardan con monto POSITIVO. Es la misma
 * semántica de `GET /caja/resumen`, extendida multi-día, para que el reporte
 * nunca diverja del cierre diario.
 *
 * Asimetría temporal deliberada (design D5/D4): a diferencia de ocupación y
 * ausentismo —cuyo `turno.inicio` es UTC y requiere `fechaContable`— acá NO se
 * aplica conversión de zona: `aplicado_en` ya es el día local del movimiento.
 *
 * Unidades: todos los montos son enteros en centavos (R2/R5). La suma y la
 * resta se hacen con aritmética entera de JavaScript (`Number.isSafeInteger`),
 * nunca con decimales.
 *
 * Separación de capas (design D8): el repositorio hace el `JOIN pago` y el
 * `GROUP BY aplicado_en, medio`; el servicio netea, ordena y proyecta el
 * contrato. La forma elegida es `crearServicioFacturacion({ repo, zonaHoraria })`.
 */
import type { PagoMedio } from '../core/models.js';
import {
  claveDeGrupo,
  ErrorPeriodoInvalido,
  validarRango,
  type Granularidad,
} from './periodo.js';
import type { FacturacionFila, ReportesRepository } from './reportes.repository.js';

/** Dependencia mínima: sólo la lectura que usa el servicio (design D8). */
export type RepositorioFacturacion = Pick<
  ReportesRepository,
  'ingresosPorAplicadoEn'
>;

export interface FacturacionDeps {
  readonly repo: RepositorioFacturacion;
  /** Zona IANA de `config.caja.zonaHoraria` (design D4); se informa, no se aplica. */
  readonly zonaHoraria: string;
}

export interface FacturacionInput {
  readonly desde: string;
  readonly hasta: string;
  /** Default `dia` si se omite (design D9). */
  readonly granularidad?: Granularidad | undefined;
  /** Acota total, `por_medio` y `series` a un único medio (design D7). */
  readonly medio?: PagoMedio | undefined;
}

export interface FacturacionConteo {
  readonly cantidad: number;
  readonly centavos: number;
}

export interface FacturacionTotal {
  readonly cobros: FacturacionConteo;
  readonly anulaciones: FacturacionConteo;
  readonly ingresos_netos_centavos: number;
  /** Neto de efectivo + tarjeta + transferencia + mercadopago. */
  readonly bolsillo_centavos: number;
  /** Neto del medio `obra_social`. */
  readonly obra_social_centavos: number;
}

/** Los cinco medios del `CHECK` de `pago.medio`, siempre presentes (design D7). */
export interface FacturacionPorMedio {
  readonly efectivo: number;
  readonly tarjeta: number;
  readonly transferencia: number;
  readonly mercadopago: number;
  readonly obra_social: number;
}

export interface FacturacionSerie {
  readonly clave: string;
  readonly ingresos_netos_centavos: number;
}

/** Contrato exacto de `GET /api/reportes/facturacion` (design D7). */
export interface FacturacionReporte {
  readonly desde: string;
  readonly hasta: string;
  readonly granularidad: Granularidad;
  readonly zona_horaria: string;
  readonly total: FacturacionTotal;
  readonly por_medio: FacturacionPorMedio;
  readonly series: readonly FacturacionSerie[];
}

export interface ServicioFacturacion {
  calcular(input: FacturacionInput): FacturacionReporte;
}

/** Catálogo de medios del dominio, en el orden del `CHECK` (task 6.4). */
export const MEDIOS_PAGO: readonly PagoMedio[] = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'mercadopago',
  'obra_social',
] as const;

/** ¿El valor recibido es un medio del dominio? (validación de query, design D9). */
export function esMedioPago(valor: string): valor is PagoMedio {
  return (MEDIOS_PAGO as readonly string[]).includes(valor);
}

/** Acumulador mutable de un bucket (serie) o del total. */
interface Acumulado {
  cobros: number;
  cobrosCantidad: number;
  anulaciones: number;
  anulacionesCantidad: number;
}

function acumuladoVacio(): Acumulado {
  return {
    cobros: 0,
    cobrosCantidad: 0,
    anulaciones: 0,
    anulacionesCantidad: 0,
  };
}

function acumular(acumulado: Acumulado, fila: FacturacionFila): void {
  acumulado.cobros += fila.cobros;
  acumulado.cobrosCantidad += fila.cobros_cantidad;
  acumulado.anulaciones += fila.anulaciones;
  acumulado.anulacionesCantidad += fila.anulaciones_cantidad;
}

function totalDesde(acumulado: Acumulado): FacturacionTotal {
  const neto = acumulado.cobros - acumulado.anulaciones;
  return {
    cobros: { cantidad: acumulado.cobrosCantidad, centavos: acumulado.cobros },
    anulaciones: {
      cantidad: acumulado.anulacionesCantidad,
      centavos: acumulado.anulaciones,
    },
    ingresos_netos_centavos: neto,
    bolsillo_centavos: 0,
    obra_social_centavos: 0,
  };
}

/** Serie ascendente por clave y sólo con movimientos (design D7: sin ceros). */
function seriesDesde(
  mapa: Map<string, Acumulado>,
): FacturacionSerie[] {
  return [...mapa.entries()]
    .sort((a, b) => {
      if (a[0] === b[0]) return 0;
      return a[0] < b[0] ? -1 : 1;
    })
    .map(([clave, acumulado]) => ({
      clave,
      ingresos_netos_centavos: acumulado.cobros - acumulado.anulaciones,
    }));
}

/**
 * Motor puro de agregación: recibe las filas del repositorio y el rango ya
 * validado. Exportado para testear la agregación sin base, aunque la suite usa
 * SQLite real (R12).
 */
export function agregarFacturacion(
  filas: readonly FacturacionFila[],
  rango: {
    readonly desde: string;
    readonly hasta: string;
    readonly granularidad: Granularidad;
  },
  zonaHoraria: string,
): FacturacionReporte {
  const series = new Map<string, Acumulado>();
  const total = acumuladoVacio();
  const porMedio = new Map<PagoMedio, Acumulado>(
    MEDIOS_PAGO.map((medio) => [medio, acumuladoVacio()]),
  );

  for (const fila of filas) {
    acumular(total, fila);
    const medio = porMedio.get(fila.medio);
    if (medio !== undefined) acumular(medio, fila);
    // `aplicado_en` ya es fecha local `YYYY-MM-DD` (design D5): no se convierte.
    const clave = claveDeGrupo(fila.aplicado_en, rango.granularidad);
    const bucket = series.get(clave);
    if (bucket === undefined) {
      const nuevo = acumuladoVacio();
      acumular(nuevo, fila);
      series.set(clave, nuevo);
    } else {
      acumular(bucket, fila);
    }
  }

  const netos: Record<PagoMedio, number> = {
    efectivo: 0,
    tarjeta: 0,
    transferencia: 0,
    mercadopago: 0,
    obra_social: 0,
  };
  for (const medio of MEDIOS_PAGO) {
    const acumulado = porMedio.get(medio);
    if (acumulado !== undefined) {
      netos[medio] = acumulado.cobros - acumulado.anulaciones;
    }
  }

  const base = totalDesde(total);
  return {
    desde: rango.desde,
    hasta: rango.hasta,
    granularidad: rango.granularidad,
    zona_horaria: zonaHoraria,
    total: {
      ...base,
      bolsillo_centavos:
        netos.efectivo + netos.tarjeta + netos.transferencia + netos.mercadopago,
      obra_social_centavos: netos.obra_social,
    },
    por_medio: {
      efectivo: netos.efectivo,
      tarjeta: netos.tarjeta,
      transferencia: netos.transferencia,
      mercadopago: netos.mercadopago,
      obra_social: netos.obra_social,
    },
    series: seriesDesde(series),
  };
}

/** Construye el servicio de facturación con sus dependencias explícitas. */
export function crearServicioFacturacion(
  deps: FacturacionDeps,
): ServicioFacturacion {
  const { repo, zonaHoraria } = deps;
  return {
    calcular(input: FacturacionInput): FacturacionReporte {
      const rango = validarRango(input.desde, input.hasta, input.granularidad);
      if (!rango.ok) {
        throw new ErrorPeriodoInvalido(rango.campo, rango.mensaje);
      }
      if (input.medio !== undefined && !esMedioPago(input.medio)) {
        throw new ErrorPeriodoInvalido(
          'medio',
          'medio debe ser efectivo, tarjeta, transferencia, mercadopago u obra_social',
        );
      }
      const filas = repo.ingresosPorAplicadoEn(
        rango.desde,
        rango.hasta,
        input.medio,
      );
      return agregarFacturacion(filas, rango, zonaHoraria);
    },
  };
}
