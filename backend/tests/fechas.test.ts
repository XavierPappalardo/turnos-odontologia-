/**
 * C-09 task 1.1: fechas.ts - normalizarIsoUtc.
 * Valida ISO 8601 con zona explícita (Z u offset), rechaza valores sin zona
 * e inválidos. No depende de agenda (no usa CrearTurnoError).
 */
import { describe, expect, it } from 'vitest';
import { normalizarIsoUtc } from '../src/shared/fechas.js';

describe('normalizarIsoUtc', () => {
  it('Dado ISO con Z Cuando normaliza Entonces devuelve ISO UTC ancho fijo con Z', () => {
    const resultado = normalizarIsoUtc('2026-11-01T10:00:00Z');
    expect(resultado).toBe('2026-11-01T10:00:00.000Z');
  });

  it('Dado ISO con offset negativo Cuando normaliza Entonces devuelve ISO UTC con Z', () => {
    const resultado = normalizarIsoUtc('2026-11-01T10:00:00-03:00');
    expect(resultado).toBe('2026-11-01T13:00:00.000Z');
  });

  it('Dado ISO con offset positivo Cuando normaliza Entonces devuelve ISO UTC con Z', () => {
    const resultado = normalizarIsoUtc('2026-11-01T10:00:00+05:30');
    expect(resultado).toBe('2026-11-01T04:30:00.000Z');
  });

  it('Dado valor sin zona horaria Cuando normaliza Entonces devuelve undefined', () => {
    expect(normalizarIsoUtc('2026-11-01T10:00:00')).toBeUndefined();
    expect(normalizarIsoUtc('2026-11-01T10:00:00.000')).toBeUndefined();
  });

  it('Dado valor inválido Cuando normaliza Entonces devuelve undefined', () => {
    expect(normalizarIsoUtc('no-es-una-fecha')).toBeUndefined();
    expect(normalizarIsoUtc('')).toBeUndefined();
    expect(normalizarIsoUtc('2026-13-01T10:00:00Z')).toBeUndefined();
  });

  it('Dado undefined Cuando normaliza Entonces devuelve undefined', () => {
    expect(normalizarIsoUtc(undefined as unknown as string)).toBeUndefined();
  });
});
