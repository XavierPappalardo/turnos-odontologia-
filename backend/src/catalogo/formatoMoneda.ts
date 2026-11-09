/**
 * Formateo determinista de moneda ARS (C-15; R2 / R5 / RN-12).
 * Convierte un valor en centavos enteros a formato local argentino: "$ X.XXX,XX".
 * Prohibido el uso de flotantes en lógica de dominio o persistencia.
 */

export function formatearMonedaArs(centavos: number): string {
  if (typeof centavos !== 'number' || !Number.isInteger(centavos)) {
    throw new Error('El monto en centavos debe ser un número entero');
  }
  if (centavos < 0) {
    throw new Error('El monto en centavos debe ser no negativo');
  }

  const enteros = Math.floor(centavos / 100);
  const restoCentavos = centavos % 100;
  const centavosStr = restoCentavos.toString().padStart(2, '0');

  // Separador de miles con punto
  const enterosStr = enteros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `$ ${enterosStr},${centavosStr}`;
}
