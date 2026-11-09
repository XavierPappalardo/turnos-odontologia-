/**
 * C-14 task 4.2/4.4 — `ocupacion.service.ts`: reporte de minutos ocupados.
 *
 * Contrato (design D3/D4/D7): `minutos_ocupados` es la suma absoluta de
 * `fin − inicio` en minutos enteros de los turnos cuyo **día local**
 * (`fechaContable`) cae en `[desde, hasta]` y cuyo estado ocupa agenda
 * (`reservado`, `confirmado`, `presente`, `atendido`). No hay denominador de
 * capacidad ni porcentaje.
 *
 * Separación de capas (design D8):
 * - El repositorio aplica la ventana GRUESA en UTC y el filtro de estado SQL.
 * - El servicio hace el filtro FINO por día local, el bucketing y los
 *   desgloses, sin tocar `db`. Es testeable con SQLite real (R12) o con
 *   cualquier objeto que cumpla `RepositorioOcupacion`.
 *
 * Forma elegida (task 4.2): `crearServicioOcupacion({ repo, zonaHoraria })`
 * devuelve `{ calcular(input) }`. La zona sale de `config.caja.zonaHoraria`;
 * el servicio nunca lee configuración global.
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
export type RepositorioOcupacion = Pick<
  ReportesRepository,
  'ocupacionEnVentana'
>;

export interface OcupacionDeps {
  readonly repo: RepositorioOcupacion;
  /** Zona IANA de `config.caja.zonaHoraria` (design D4). */
  readonly zonaHoraria: string;
}

export interface OcupacionInput {
  readonly desde: string;
  readonly hasta: string;
  /** Default `dia` si se omite (design D9). */
  readonly granularidad?: Granularidad | undefined;
  readonly profesionalId?: string | undefined;
  readonly sillonId?: string | undefined;
}

export interface OcupacionTotal {
  readonly turnos: number;
  readonly minutos_ocupados: number;
}

export interface OcupacionSerie extends OcupacionTotal {
  readonly clave: string;
}

export interface OcupacionPorProfesional extends OcupacionTotal {
  readonly profesional_id: string;
}

export interface OcupacionPorSillon extends OcupacionTotal {
  readonly sillon_id: string;
}

/** Contrato exacto de `GET /api/reportes/ocupacion` (design D7). */
export interface OcupacionReporte {
  readonly desde: string;
  readonly hasta: string;
  readonly granularidad: Granularidad;
  readonly zona_horaria: string;
  readonly total: OcupacionTotal;
  readonly series: readonly OcupacionSerie[];
  readonly por_profesional: readonly OcupacionPorProfesional[];
  readonly por_sillon: readonly OcupacionPorSillon[];
}

export interface ServicioOcupacion {
  calcular(input: OcupacionInput): OcupacionReporte;
}

/**
 * Estados que ocupan agenda (design D3). El repositorio ya los filtra en SQL;
 * el servicio re-verifica para blindar el cálculo ante otro repositorio.
 */
const ESTADOS_QUE_OCUPAN: readonly TurnoEstado[] = [
  'reservado',
  'confirmado',
  'presente',
  'atendido',
];

const MS_POR_MINUTO = 60_000;

/** Acumulador mutable reutilizado por total, series y desgloses (task 4.4). */
interface Acumulado {
  turnos: number;
  minutos_ocupados: number;
}

function acumular(
  mapa: Map<string, Acumulado>,
  clave: string,
  minutos: number,
): void {
  const actual = mapa.get(clave);
  if (actual === undefined) {
    mapa.set(clave, { turnos: 1, minutos_ocupados: minutos });
    return;
  }
  actual.turnos += 1;
  actual.minutos_ocupados += minutos;
}

/** Minutos enteros de `fin − inicio`. Redondeo half-up sólo si hay fracción. */
function minutosDeTurno(inicio: string, fin: string): number {
  const ms = Date.parse(fin) - Date.parse(inicio);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / MS_POR_MINUTO);
}

/** Orden ascendente por clave (las claves del módulo ordenan cronológicamente). */
function compararClaves(a: [string, Acumulado], b: [string, Acumulado]): number {
  if (a[0] === b[0]) return 0;
  return a[0] < b[0] ? -1 : 1;
}

/** Orden descendente por minutos ocupados; empate resuelto por id ascendente. */
function porMinutosDesc(
  a: { readonly id: string; readonly minutos_ocupados: number },
  b: { readonly id: string; readonly minutos_ocupados: number },
): number {
  if (b.minutos_ocupados !== a.minutos_ocupados) {
    return b.minutos_ocupados - a.minutos_ocupados;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Serie ordenada ascendente, sin relleno de ceros (design D7). */
function seriesDesde(mapa: Map<string, Acumulado>): OcupacionSerie[] {
  return [...mapa.entries()].sort(compararClaves).map(([clave, acumulado]) => ({
    clave,
    turnos: acumulado.turnos,
    minutos_ocupados: acumulado.minutos_ocupados,
  }));
}

function profesionalesDesde(
  mapa: Map<string, Acumulado>,
): OcupacionPorProfesional[] {
  return [...mapa.entries()]
    .map(([id, acumulado]) => ({
      id,
      turnos: acumulado.turnos,
      minutos_ocupados: acumulado.minutos_ocupados,
    }))
    .sort(porMinutosDesc)
    .map(({ id, turnos, minutos_ocupados }) => ({
      profesional_id: id,
      turnos,
      minutos_ocupados,
    }));
}

function sillonesDesde(mapa: Map<string, Acumulado>): OcupacionPorSillon[] {
  return [...mapa.entries()]
    .map(([id, acumulado]) => ({
      id,
      turnos: acumulado.turnos,
      minutos_ocupados: acumulado.minutos_ocupados,
    }))
    .sort(porMinutosDesc)
    .map(({ id, turnos, minutos_ocupados }) => ({
      sillon_id: id,
      turnos,
      minutos_ocupados,
    }));
}

/**
 * Motor puro de agregación: recibe las filas del repositorio y el rango ya
 * validado. Exportado para poder testear la agregación sin base, aunque la
 * suite use SQLite real (R12).
 */
export function agregarOcupacion(
  filas: readonly OcupacionFila[],
  rango: {
    readonly desde: string;
    readonly hasta: string;
    readonly granularidad: Granularidad;
  },
  zonaHoraria: string,
): OcupacionReporte {
  const series = new Map<string, Acumulado>();
  const porProfesional = new Map<string, Acumulado>();
  const porSillon = new Map<string, Acumulado>();
  const total: Acumulado = { turnos: 0, minutos_ocupados: 0 };

  for (const fila of filas) {
    if (!(ESTADOS_QUE_OCUPAN as readonly string[]).includes(fila.estado)) {
      continue;
    }
    const fechaLocal = fechaContable(fila.inicio, zonaHoraria);
    if (fechaLocal < rango.desde || fechaLocal > rango.hasta) continue;
    const minutos = minutosDeTurno(fila.inicio, fila.fin);
    total.turnos += 1;
    total.minutos_ocupados += minutos;
    acumular(series, claveDeGrupo(fechaLocal, rango.granularidad), minutos);
    acumular(porProfesional, fila.profesional_id, minutos);
    acumular(porSillon, fila.sillon_id, minutos);
  }

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    granularidad: rango.granularidad,
    zona_horaria: zonaHoraria,
    total: { turnos: total.turnos, minutos_ocupados: total.minutos_ocupados },
    series: seriesDesde(series),
    por_profesional: profesionalesDesde(porProfesional),
    por_sillon: sillonesDesde(porSillon),
  };
}

/** Construye el servicio de ocupación con sus dependencias explícitas. */
export function crearServicioOcupacion(
  deps: OcupacionDeps,
): ServicioOcupacion {
  const { repo, zonaHoraria } = deps;
  return {
    calcular(input: OcupacionInput): OcupacionReporte {
      const rango = validarRango(input.desde, input.hasta, input.granularidad);
      if (!rango.ok) {
        throw new ErrorPeriodoInvalido(rango.campo, rango.mensaje);
      }
      const filtros: FiltrosTurnos = {
        profesionalId: input.profesionalId,
        sillonId: input.sillonId,
      };
      const { desdeUtc, hastaUtc } = ventanaUtcGruesa(
        rango.desde,
        rango.hasta,
      );
      const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc, filtros);
      return agregarOcupacion(filas, rango, zonaHoraria);
    },
  };
}
