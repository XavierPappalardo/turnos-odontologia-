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

/**
 * Fecha contable de caja (C-11, design D11): día local `YYYY-MM-DD` de un
 * instante ISO UTC dentro de una zona horaria IANA, vía `Intl.DateTimeFormat`
 * con locale numérico `en-CA` (produce exactamente `YYYY-MM-DD`).
 * Función pura: no depende del reloj ni de la zona local del host.
 * La zona debe estar validada al cargar configuración (una `Intl.DateTimeFormat`
 * construida con la zona y capturando el error); con zona inválida lanza
 * `RangeError` del propio `Intl`.
 */
export function fechaContable(
  instantIsoUtc: string,
  zona: string,
): string {
  const ms = Date.parse(
    typeof instantIsoUtc === 'string' ? instantIsoUtc.trim() : '',
  );
  if (Number.isNaN(ms)) {
    throw new Error('instante ISO UTC inválido para fecha contable');
  }

  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formato.format(new Date(ms));
}
