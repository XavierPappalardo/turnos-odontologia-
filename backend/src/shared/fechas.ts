/**
 * C-09 task 1.1: fechas.ts - núcleo puro de normalización de fechas ISO 8601.
 * Extraído de `agenda/crearTurno.service.ts` sin cambiar su comportamiento.
 * Requiere zona horaria explícita (Z o ±hh:mm); devuelve ISO UTC ancho fijo.
 */
export function normalizarIsoUtc(valor: string): string | undefined {
  if (typeof valor !== 'string' || valor.trim() === '') return undefined;

  const ms = Date.parse(valor);
  if (Number.isNaN(ms)) return undefined;

  // Exigir zona horaria explícita para evitar comparaciones lexicográficas ambiguas.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(valor.trim())) return undefined;

  return new Date(ms).toISOString();
}
