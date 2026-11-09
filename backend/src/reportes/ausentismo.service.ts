/**
 * C-14 task 5.2/5.4 — `ausentismo.service.ts`: tasa de ausentismo entera.
 *
 * Contrato (design D6/D7): el numerador son los turnos `ausente` y el
 * denominador los turnos **resueltos** (`atendido` + `ausente`) cuyo día local
 * (`fechaContable`) cae en `[desde, hasta]`. Los turnos abiertos (`reservado`,
 * `confirmado`, `presente`) y los `cancelado` quedan fuera de ambos términos.
 *
 * `tasa_ausentismo_pct` es DERIVADA y se emite como entero 0..100 con redondeo
 * half-up (R6). Con `resueltos = 0` se devuelve `null`: "sin datos" no es
 * "0 % de ausentismo". Una única función pura (`tasaAusentismo`) alimenta
 * total, series y desglose (task 5.4), de modo que las tres vistas no pueden
 * divergir.
 *
 * Separación de capas (design D8): el repositorio aplica la ventana GRUESA en
 * UTC y el filtro SQL de estados resueltos; el servicio hace el filtro FINO por
 * día local, el bucketing y la tasa, sin tocar `db`. Igual que en ocupación, la
 * forma elegida es `crearServicioAusentismo({ repo, zonaHoraria })`.
 */
import { fechaContable } from '../shared/fechas.js';
import type { TurnoEstado } from '../shared/types.js';
import {
  claveDeGrupo,
  ErrorPeriodoInvalido,
  validarRango,
  ventanaUtcGruesa,
  type Granularidad,
} from './periodo.js';
import type {
  FiltrosTurnos,
  OcupacionFila,
  ReportesRepository,
} from './reportes.repository.js';

/** Dependencia mínima: sólo la lectura que usa el servicio (design D8). */
export type RepositorioAusentismo = Pick<
  ReportesRepository,
  'resueltosEnVentana'
>;

export interface AusentismoDeps {
  readonly repo: RepositorioAusentismo;
  /** Zona IANA de `config.caja.zonaHoraria` (design D4). */
  readonly zonaHoraria: string;
}

export interface AusentismoInput {
  readonly desde: string;
  readonly hasta: string;
  /** Default `dia` si se omite (design D9). */
  readonly granularidad?: Granularidad | undefined;
  readonly profesionalId?: string | undefined;
}

export interface AusentismoMetricas {
  readonly ausentes: number;
  readonly resueltos: number;
  /** Entero 0..100 o `null` cuando no hay turnos resueltos (design D6). */
  readonly tasa_ausentismo_pct: number | null;
}

export interface AusentismoSerie extends AusentismoMetricas {
  readonly clave: string;
}

export interface AusentismoPorProfesional extends AusentismoMetricas {
  readonly profesional_id: string;
}

/** Contrato exacto de `GET /api/reportes/ausentismo` (design D7). */
export interface AusentismoReporte {
  readonly desde: string;
  readonly hasta: string;
  readonly granularidad: Granularidad;
  readonly zona_horaria: string;
  readonly total: AusentismoMetricas;
  readonly series: readonly AusentismoSerie[];
  readonly por_profesional: readonly AusentismoPorProfesional[];
}

export interface ServicioAusentismo {
  calcular(input: AusentismoInput): AusentismoReporte;
}

/**
 * Estados del denominador (design D6). El repositorio ya los filtra en SQL; el
 * servicio re-verifica para blindar el cálculo ante otro repositorio.
 */
const ESTADOS_RESUELTOS: readonly TurnoEstado[] = ['atendido', 'ausente'];

const ESTADO_AUSENTE: TurnoEstado = 'ausente';

/** Acumulador mutable compartido por total, series y desglose. */
interface Acumulado {
  ausentes: number;
  resueltos: number;
}

/**
 * Tasa de ausentismo como entero 0..100 con redondeo **half-up** y aritmética
 * entera (sin coma flotante, task 5.4/R6).
 *
 * `round_half_up(a * 100 / r)` se calcula como `floor((2 * a * 100 + r) / (2r))`:
 * para valores no negativos el redondeo half-up coincide con `floor(x + 0.5)`.
 * Devuelve `null` cuando `resueltos = 0` (design D6: "sin datos" ≠ "0 %").
 */
export function tasaAusentismo(
  ausentes: number,
  resueltos: number,
): number | null {
  if (resueltos <= 0) return null;
  const numerador = ausentes * 200 + resueltos;
  const denominador = resueltos * 2;
  const tasa = Math.floor(numerador / denominador);
  if (tasa < 0) return 0;
  return tasa > 100 ? 100 : tasa;
}

/** Proyecta el acumulador a las tres métricas del contrato, con la tasa única. */
function metricasDe(acumulado: Acumulado): AusentismoMetricas {
  return {
    ausentes: acumulado.ausentes,
    resueltos: acumulado.resueltos,
    tasa_ausentismo_pct: tasaAusentismo(acumulado.ausentes, acumulado.resueltos),
  };
}

function acumularUna(
  mapa: Map<string, Acumulado>,
  clave: string,
  esAusente: boolean,
): void {
  const actual = mapa.get(clave);
  if (actual === undefined) {
    mapa.set(clave, {
      ausentes: esAusente ? 1 : 0,
      resueltos: 1,
    });
    return;
  }
  if (esAusente) actual.ausentes += 1;
  actual.resueltos += 1;
}

/** Orden ascendente por clave: las claves del módulo ordenan cronológicamente. */
function compararClaves(
  a: [string, Acumulado],
  b: [string, Acumulado],
): number {
  if (a[0] === b[0]) return 0;
  return a[0] < b[0] ? -1 : 1;
}

/** Serie ascendente y sólo con buckets con datos (design D7: sin ceros). */
function seriesDesde(mapa: Map<string, Acumulado>): AusentismoSerie[] {
  return [...mapa.entries()]
    .sort(compararClaves)
    .map(([clave, acumulado]) => ({ clave, ...metricasDe(acumulado) }));
}

/**
 * Desglose por profesional con turnos resueltos. Orden estable: más turnos
 * resueltos primero y, a igualdad, `profesional_id` ascendente (el design no
 * fija un orden para esta vista; se elige uno determinista).
 */
function profesionalesDesde(
  mapa: Map<string, Acumulado>,
): AusentismoPorProfesional[] {
  return [...mapa.entries()]
    .sort((a, b) => {
      if (b[1].resueltos !== a[1].resueltos) {
        return b[1].resueltos - a[1].resueltos;
      }
      if (a[0] === b[0]) return 0;
      return a[0] < b[0] ? -1 : 1;
    })
    .map(([profesionalId, acumulado]) => ({
      profesional_id: profesionalId,
      ...metricasDe(acumulado),
    }));
}

/**
 * Motor puro de agregación: recibe las filas del repositorio y el rango ya
 * validado. Exportado para testear la agregación sin base, aunque la suite usa
 * SQLite real (R12).
 */
export function agregarAusentismo(
  filas: readonly OcupacionFila[],
  rango: {
    readonly desde: string;
    readonly hasta: string;
    readonly granularidad: Granularidad;
  },
  zonaHoraria: string,
): AusentismoReporte {
  const series = new Map<string, Acumulado>();
  const porProfesional = new Map<string, Acumulado>();
  const total: Acumulado = { ausentes: 0, resueltos: 0 };

  for (const fila of filas) {
    if (!(ESTADOS_RESUELTOS as readonly string[]).includes(fila.estado)) {
      continue;
    }
    const fechaLocal = fechaContable(fila.inicio, zonaHoraria);
    if (fechaLocal < rango.desde || fechaLocal > rango.hasta) continue;
    const esAusente = fila.estado === ESTADO_AUSENTE;
    if (esAusente) total.ausentes += 1;
    total.resueltos += 1;
    acumularUna(series, claveDeGrupo(fechaLocal, rango.granularidad), esAusente);
    acumularUna(porProfesional, fila.profesional_id, esAusente);
  }

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    granularidad: rango.granularidad,
    zona_horaria: zonaHoraria,
    total: metricasDe(total),
    series: seriesDesde(series),
    por_profesional: profesionalesDesde(porProfesional),
  };
}

/** Construye el servicio de ausentismo con sus dependencias explícitas. */
export function crearServicioAusentismo(
  deps: AusentismoDeps,
): ServicioAusentismo {
  const { repo, zonaHoraria } = deps;
  return {
    calcular(input: AusentismoInput): AusentismoReporte {
      const rango = validarRango(input.desde, input.hasta, input.granularidad);
      if (!rango.ok) {
        throw new ErrorPeriodoInvalido(rango.campo, rango.mensaje);
      }
      const filtros: FiltrosTurnos = { profesionalId: input.profesionalId };
      const { desdeUtc, hastaUtc } = ventanaUtcGruesa(
        rango.desde,
        rango.hasta,
      );
      const filas = repo.resueltosEnVentana(desdeUtc, hastaUtc, filtros);
      return agregarAusentismo(filas, rango, zonaHoraria);
    },
  };
}
