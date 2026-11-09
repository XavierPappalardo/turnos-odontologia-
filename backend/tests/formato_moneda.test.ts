/**
 * Tests para el formateador utilitario de moneda ARS (C-15).
 * Valida la conversión determinista de montos en centavos enteros
 * a formato de moneda nacional ($ X.XXX,XX), así como el rechazo
 * de números negativos, fraccionarios o no válidos (R2, R5).
 */
import { describe, expect, it } from 'vitest';
import { formatearMonedaArs } from '../src/catalogo/formatoMoneda.js';

describe('formatearMonedaArs — Formato determinista en ARS', () => {
  it('Dado 0 centavos Cuando formatea Entonces retorna "$ 0,00"', () => {
    expect(formatearMonedaArs(0)).toBe('$ 0,00');
  });

  it('Dado 50 centavos Cuando formatea Entonces retorna "$ 0,50"', () => {
    expect(formatearMonedaArs(50)).toBe('$ 0,50');
  });

  it('Dado 100 centavos Cuando formatea Entonces retorna "$ 1,00"', () => {
    expect(formatearMonedaArs(100)).toBe('$ 1,00');
  });

  it('Dado 150000 centavos Cuando formatea Entonces retorna "$ 1.500,00" con separador de miles', () => {
    expect(formatearMonedaArs(150000)).toBe('$ 1.500,00');
  });

  it('Dado 2500000 centavos Cuando formatea Entonces retorna "$ 25.000,00"', () => {
    expect(formatearMonedaArs(2500000)).toBe('$ 25.000,00');
  });

  it('Dado 123456789 centavos Cuando formatea Entonces retorna "$ 1.234.567,89"', () => {
    expect(formatearMonedaArs(123456789)).toBe('$ 1.234.567,89');
  });

  it('Dado un número negativo Cuando intenta formatear Entonces arroja error', () => {
    expect(() => formatearMonedaArs(-100)).toThrow(/no negativo/i);
  });

  it('Dado un número con punto flotante o NaN Cuando intenta formatear Entonces arroja error', () => {
    expect(() => formatearMonedaArs(100.5)).toThrow(/entero/i);
    expect(() => formatearMonedaArs(NaN)).toThrow(/entero/i);
  });
});
