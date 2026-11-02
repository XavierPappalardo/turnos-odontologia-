/**
 * C-09 task 3.2: Dominio FDI - validación pura de pieza, superficie y combinación.
 * Sin dependencias de BD ni ORM.
 * Diseño D7: pieza→superficie como regla de dominio pura, no como CHECK de SQLite.
 */

/** Piezas FDI permanentes válidas: 11-48 (excluyendo 19, 29, 39, 49). */
const PIEZAS_PERMANENTES_VALIDAS: readonly number[] = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
];

/** Piezas FDI temporales válidas: 51-55, 61-65, 71-75, 81-85 (5 por cuadrante). */
const PIEZAS_TEMPORALES_VALIDAS: readonly number[] = [
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
];

const PIEZAS_VALIDAS = new Set([...PIEZAS_PERMANENTES_VALIDAS, ...PIEZAS_TEMPORALES_VALIDAS]);

/** Array ordenado de las 52 piezas FDI válidas (para tests y consumo externo). */
export const PIEZAS_VALIDAS_ARRAY: readonly number[] = [
  ...PIEZAS_PERMANENTES_VALIDAS,
  ...PIEZAS_TEMPORALES_VALIDAS,
];

/** Superficies válidas según diseño D7. */
const SUPERFICIES_VALIDAS = new Set(['M', 'D', 'V', 'L', 'O', 'I']);

/** Piezas donde `I` (incisal) es válido: incisivos y caninos (permanentes y temporales). */
const PIEZAS_CON_I = new Set([
  // Incisivos y caninos permanentes
  11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43,
  // Incisivos y caninos temporales
  51, 52, 53, 61, 62, 63, 71, 72, 73, 81, 82, 83,
]);

/** Piezas donde `O` (oclusal) es válido: premolares y molares (permanentes y temporales). */
const PIEZAS_CON_O = new Set([
  // Premolares permanentes
  14, 15, 24, 25, 34, 35, 44, 45,
  // Molares permanentes
  16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48,
  // Molares temporales
  54, 55, 64, 65, 74, 75, 84, 85,
]);

/**
 * Valida que una pieza FDI sea válida (permanente 11-48 o temporal 51-85,
 * excluyendo valores intermedios inválidos).
 */
export function esPiezaFdiValida(pieza: number): boolean {
  return PIEZAS_VALIDAS.has(pieza);
}

/**
 * Valida que una superficie sea una de M, D, V, L, O, I.
 */
export function esSuperficieValida(superficie: string): boolean {
  return SUPERFICIES_VALIDAS.has(superficie);
}

/**
 * Valida la combinación pieza→superficie según regla de dominio pura (diseño D7).
 * `I` solo en incisivos/caninos; `O` solo en premolares/molares;
 * M/D/V/L en todas las piezas válidas.
 */
export function esCombinacionValida(pieza: number, superficie: string): boolean {
  if (!esPiezaFdiValida(pieza)) return false;
  if (!esSuperficieValida(superficie)) return false;

  if (superficie === 'I') return PIEZAS_CON_I.has(pieza);
  if (superficie === 'O') return PIEZAS_CON_O.has(pieza);
  // M, D, V, L son válidos en cualquier pieza FDI válida
  return true;
}
