/**
 * C-14 task 1.2/1.3 — `periodo.ts`: aritmética temporal PURA de reportes.
 *
 * Reglas de diseño aplicadas:
 * - D4: la agrupación temporal es local (`America/Buenos_Aires` u otra zona
 *   configurada) y se resuelve en el servicio con `fechaContable`. Este módulo
 *   NO conoce la base de datos ni `config`; sólo fechas locales `YYYY-MM-DD`.
 * - D9: `validarRango` concentra las reglas de entrada (formato, fecha real,
 *   orden, tope de 366 días inclusive y granularidad).
 * - R2/R6: sólo se producen cantidades enteras; acá no hay montos.
 *
 * Contrato de error (elegido por testeabilidad, ver tasks.md 1.2):
 * `validarRango` NO lanza. Devuelve una **unión discriminada**
 * `{ ok: true, ... } | { ok: false, campo, mensaje }`, de modo que:
 *   - la ruta (task 8.x) la traduce a `ReportesError` con `detalle.campo`;
 *   - los servicios la convierten en `ErrorPeriodoInvalido` (defensivo);
 *   - los tests afirman el resultado sin `try/catch`.
 * Los mensajes describen el campo y nunca repiten el valor recibido (R3).
 */

/** Granularidades admitidas por el contrato de reportes (design D7). */
export type Granularidad = 'dia' | 'semana' | 'mes';

export const GRANULARIDADES: readonly Granularidad[] = [
  'dia',
  'semana',
  'mes',
] as const;

/** Campo del request que originó un rechazo de validación. */
export type CampoInvalido =
  | 'desde'
  | 'hasta'
  | 'rango'
  | 'granularidad'
  | 'medio';

/** Resultado tipado de `validarRango` (nunca lanza). */
export type ResultadoValidacionRango =
  | {
      readonly ok: true;
      readonly desde: string;
      readonly hasta: string;
      readonly granularidad: Granularidad;
      /** Días del rango, contando ambos extremos (2026-11-01..2026-11-01 = 1). */
      readonly dias: number;
    }
  | {
      readonly ok: false;
      readonly campo: CampoInvalido;
      readonly mensaje: string;
    };

/** Error de período para uso interno de los servicios (la ruta usa la unión). */
export class ErrorPeriodoInvalido extends Error {
  readonly campo: CampoInvalido;

  constructor(campo: CampoInvalido, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorPeriodoInvalido';
    this.campo = campo;
  }
}

const FORMATO_FECHA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;
const MAX_DIAS_RANGO = 366;

interface PartesFecha {
  readonly anio: number;
  readonly mes: number;
  readonly dia: number;
}

/** Descompone `YYYY-MM-DD` en partes numéricas sin validar existencia real. */
function partesFecha(fecha: string): PartesFecha | undefined {
  const coincidencia = FORMATO_FECHA_LOCAL.exec(fecha);
  if (coincidencia === null) return undefined;
  return {
    anio: Number.parseInt(coincidencia[1], 10),
    mes: Number.parseInt(coincidencia[2], 10),
    dia: Number.parseInt(coincidencia[3], 10),
  };
}

/** Milisegundos UTC de una fecha local tratada como día calendario puro. */
function msDeFechaLocal(fecha: string): number | undefined {
  const partes = partesFecha(fecha);
  if (partes === undefined) return undefined;
  const ms = Date.UTC(partes.anio, partes.mes - 1, partes.dia);
  const reconstruida = new Date(ms);
  // Rechaza días inexistentes (2026-02-31 → 2026-03-03) y meses fuera de 1..12.
  if (
    reconstruida.getUTCFullYear() !== partes.anio ||
    reconstruida.getUTCMonth() !== partes.mes - 1 ||
    reconstruida.getUTCDate() !== partes.dia
  ) {
    return undefined;
  }
  return ms;
}

/** Suma días enteros sobre `YYYY-MM-DD` con aritmética UTC (día puro, sin DST). */
function sumarDias(fecha: string, dias: number): string {
  const ms = msDeFechaLocal(fecha);
  if (ms === undefined) {
    throw new Error('fecha local inválida en aritmética de días');
  }
  return new Date(ms + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

/**
 * ¿Es `YYYY-MM-DD` una fecha local real? Rechaza formatos alternativos
 * (`01-11-2026`), strings vacíos, meses fuera de rango y días inexistentes
 * (`2026-02-31`). Acepta bisiestos (`2024-02-29`).
 */
export function esFechaLocalValida(valor: string): boolean {
  return typeof valor === 'string' && msDeFechaLocal(valor) !== undefined;
}

/**
 * Días del rango **contando ambos extremos** (2026-11-01..2026-11-07 = 7).
 * Precondición: ambas fechas ya validadas con `esFechaLocalValida`.
 * Lanza sólo ante un error de programación (fecha inválida).
 */
export function diasEntre(desde: string, hasta: string): number {
  const msDesde = msDeFechaLocal(desde);
  const msHasta = msDeFechaLocal(hasta);
  if (msDesde === undefined || msHasta === undefined) {
    throw new Error('diasEntre requiere fechas locales válidas');
  }
  return Math.round((msHasta - msDesde) / MS_POR_DIA) + 1;
}

/**
 * Valida `desde`, `hasta` y `granularidad` antes de tocar la base (design D9).
 * - `granularidad` omitida o vacía cae en `dia` (design D9 / task 8.3).
 * - El tope es 366 días **inclusive** (task 1.1).
 * Devuelve la unión discriminada; nunca lanza (ver contrato de error arriba).
 */
export function validarRango(
  desde: string,
  hasta: string,
  granularidad?: string,
): ResultadoValidacionRango {
  if (!esFechaLocalValida(desde)) {
    return {
      ok: false,
      campo: 'desde',
      mensaje: 'desde debe ser una fecha local YYYY-MM-DD existente',
    };
  }
  if (!esFechaLocalValida(hasta)) {
    return {
      ok: false,
      campo: 'hasta',
      mensaje: 'hasta debe ser una fecha local YYYY-MM-DD existente',
    };
  }
  const granularidadElegida: Granularidad | undefined =
    granularidad === undefined || granularidad.trim() === ''
      ? 'dia'
      : (GRANULARIDADES as readonly string[]).includes(granularidad)
        ? (granularidad as Granularidad)
        : undefined;
  if (granularidadElegida === undefined) {
    return {
      ok: false,
      campo: 'granularidad',
      mensaje: 'granularidad debe ser dia, semana o mes',
    };
  }
  const dias = diasEntre(desde, hasta);
  if (dias < 1) {
    return {
      ok: false,
      campo: 'rango',
      mensaje: 'desde no puede ser posterior a hasta',
    };
  }
  if (dias > MAX_DIAS_RANGO) {
    return {
      ok: false,
      campo: 'rango',
      mensaje: 'el rango no puede superar los 366 dias',
    };
  }
  return { ok: true, desde, hasta, granularidad: granularidadElegida, dias };
}

/** Día ISO de la semana: lunes = 1 … domingo = 7 (JS usa domingo = 0). */
function diaIsoDeSemana(fecha: Date): number {
  const diaJs = fecha.getUTCDay();
  return diaJs === 0 ? 7 : diaJs;
}

/**
 * Jueves de la semana ISO de una fecha (regla estándar: la semana pertenece al
 * año de su jueves). Arranca en la medianoche UTC del día local para no
 * arrastrar componentes de hora ni DST.
 */
function juevesDeSemanaIso(fechaLocal: string): Date {
  const ms = msDeFechaLocal(fechaLocal);
  if (ms === undefined) {
    throw new Error('fecha local inválida para clave de semana ISO');
  }
  const fecha = new Date(ms);
  fecha.setUTCDate(fecha.getUTCDate() + 4 - diaIsoDeSemana(fecha));
  return fecha;
}

/**
 * Número de semana ISO del año de su jueves: 1..53, con la semana 1 como la
 * que contiene el primer jueves del año.
 */
function numeroSemanaIso(jueves: Date): { anio: number; semana: number } {
  const anio = jueves.getUTCFullYear();
  const inicioAnio = Date.UTC(anio, 0, 1);
  const semana = Math.ceil(
    ((jueves.getTime() - inicioAnio) / MS_POR_DIA + 1) / 7,
  );
  return { anio, semana };
}

/**
 * Clave ISO-8601 de semana (`YYYY-Www`, lunes como primer día) de una fecha
 * local, calculada sobre el día calendario local (design D4), nunca sobre el
 * instante UTC.
 */
export function claveSemanaIso(fechaLocal: string): string {
  const { anio, semana } = numeroSemanaIso(juevesDeSemanaIso(fechaLocal));
  return `${anio}-W${String(semana).padStart(2, '0')}`;
}

/**
 * Clave de bucket de una fecha local según granularidad (design D4):
 * `dia` → `YYYY-MM-DD`, `semana` → `YYYY-Www` ISO, `mes` → `YYYY-MM`.
 * Las claves producidas ordenan lexicográficamente igual que cronológicamente.
 */
export function claveDeGrupo(
  fechaLocal: string,
  granularidad: Granularidad,
): string {
  switch (granularidad) {
    case 'dia':
      return fechaLocal;
    case 'semana':
      return claveSemanaIso(fechaLocal);
    case 'mes':
      return fechaLocal.slice(0, 7);
  }
}

/**
 * Ventana UTC **gruesa** del design D4: `[desde − 1 día, hasta + 2 días)` a las
 * 00:00Z. Cubre cualquier offset IANA entre −12 y +14 con margen. El filtro
 * preciso por día local lo hace el servicio con `fechaContable`; el repositorio
 * sólo aplica estos límites como `inicio >= desdeUtc AND inicio < hastaUtc`.
 */
export function ventanaUtcGruesa(
  desde: string,
  hasta: string,
): { readonly desdeUtc: string; readonly hastaUtc: string } {
  return {
    desdeUtc: `${sumarDias(desde, -1)}T00:00:00.000Z`,
    hastaUtc: `${sumarDias(hasta, 2)}T00:00:00.000Z`,
  };
}
