import { describe, expect, it } from 'vitest';
import {
  calcularCobertura,
  MontoNoRepresentableError,
} from '../src/obras-sociales/coberturas.service.js';

describe('calcularCobertura (función pura BigInt)', () => {
  it('Dado cobertura 0% Cuando se calcula Entonces cobertura es 0 y saldo es igual al total', () => {
    const res = calcularCobertura(50000, 0);
    expect(res).toEqual({
      cobertura_centavos: 0,
      saldo_paciente_centavos: 50000,
    });
  });

  it('Dado cobertura 100% Cuando se calcula Entonces cobertura es igual al total y saldo es 0', () => {
    const res = calcularCobertura(50000, 100);
    expect(res).toEqual({
      cobertura_centavos: 50000,
      saldo_paciente_centavos: 0,
    });
  });

  it('Dado ejemplo FL-04 (5.000.000 centavos y 60%) Cuando se calcula Entonces 3.000.000 cobertura y 2.000.000 saldo', () => {
    const res = calcularCobertura(5000000, 60);
    expect(res).toEqual({
      cobertura_centavos: 3000000,
      saldo_paciente_centavos: 2000000,
    });
  });

  it('Dado división no exacta (333 centavos y 50%) Cuando se calcula Entonces trunca la división BigInt (Q1)', () => {
    // 333 * 50 = 16650. 16650 / 100 = 166. Saldo = 333 - 166 = 167.
    const res = calcularCobertura(333, 50);
    expect(res).toEqual({
      cobertura_centavos: 166,
      saldo_paciente_centavos: 167,
    });
    expect(res.cobertura_centavos + res.saldo_paciente_centavos).toBe(333);
  });

  it('Dado producto intermedio superior a 2^53 con entrada válida en safe integer Cuando se calcula Entonces mantiene exactitud exacta sin desborde silencioso', () => {
    // Number.MAX_SAFE_INTEGER es 9007199254740991 (aprox 9 * 10^15).
    // Si monto es 9_000_000_000_000_000 (menor a MAX_SAFE_INTEGER) y pct es 50:
    // producto intermedio es 450_000_000_000_000_000 (> 2^53).
    // En BigInt no hay desborde, y el resultado final es 4_500_000_000_000_000 (seguro en JS).
    const monto = 9_000_000_000_000_000;
    expect(Number.isSafeInteger(monto)).toBe(true);

    const res = calcularCobertura(monto, 50);
    expect(res.cobertura_centavos).toBe(4_500_000_000_000_000);
    expect(res.saldo_paciente_centavos).toBe(4_500_000_000_000_000);
    expect(res.cobertura_centavos + res.saldo_paciente_centavos).toBe(monto);
  });

  it('Dado monto superior a Number.MAX_SAFE_INTEGER Cuando se envía a calcularCobertura Entonces rechaza con error de validación', () => {
    // Entrada fuera de MAX_SAFE_INTEGER
    const montoInseguro = 10_000_000_000_000_000; // 10^16 > MAX_SAFE_INTEGER
    expect(Number.isSafeInteger(montoInseguro)).toBe(false);

    expect(() => calcularCobertura(montoInseguro, 100)).toThrow(
      MontoNoRepresentableError,
    );
  });

  it('Dado monto negativo o no entero Cuando se calcula Entonces lanza error', () => {
    expect(() => calcularCobertura(-1, 50)).toThrow();
    expect(() => calcularCobertura(100.5, 50)).toThrow();
  });

  it('Dado porcentaje fuera de 0..100 o no entero Cuando se calcula Entonces lanza error', () => {
    expect(() => calcularCobertura(1000, -1)).toThrow();
    expect(() => calcularCobertura(1000, 101)).toThrow();
    expect(() => calcularCobertura(1000, 50.5)).toThrow();
  });
});
