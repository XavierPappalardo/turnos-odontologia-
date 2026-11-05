/**
 * C-09 task 1.1: fechas.ts - normalizarIsoUtc.
 * Valida ISO 8601 con zona explícita (Z u offset), rechaza valores sin zona
 * e inválidos. No depende de agenda (no usa CrearTurnoError).
 */
import { describe, expect, it } from 'vitest';
import { normalizarIsoUtc, fechaContable } from '../src/shared/fechas.js';

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

describe('fechaContable (C-11, design D11)', () => {
  it('Dado un instante UTC inmediatamente posterior a la medianoche local ARS Cuando calculo la fecha contable Entonces devuelve el día local anterior al día UTC', () => {
    // 02:30 UTC = 23:30 del día anterior en America/Buenos_Aires (UTC-3).
    expect(fechaContable('2026-06-01T02:30:00.000Z', 'America/Buenos_Aires')).toBe(
      '2026-05-31',
    );
  });

  it('Dado un instante en Asia/Kathmandu (+05:45) Cuando calculo la fecha contable Entonces el día local puede ser el siguiente al día UTC', () => {
    // 18:30 UTC → 00:15 del día siguiente en +05:45.
    expect(fechaContable('2026-06-01T18:30:00.000Z', 'Asia/Kathmandu')).toBe(
      '2026-06-02',
    );
  });

  it('Dado un instante dentro de la tarde local Cuando calculo la fecha contable Entonces coincide con el día civil local en zona ARS', () => {
    expect(fechaContable('2026-06-01T15:00:00.000Z', 'America/Buenos_Aires')).toBe(
      '2026-06-01',
    );
  });

  it('Dado dos zonas IANA equivalentes (nombre canónico y alias) Cuando calculo la fecha contable del mismo instante Entonces ambas devuelven el mismo día', () => {
    const canonica = fechaContable('2026-06-01T15:00:00.000Z', 'America/Buenos_Aires');
    const alias = fechaContable('2026-06-01T15:00:00.000Z', 'America/Argentina/Buenos_Aires');
    expect(alias).toBe(canonica);
  });

  it('Dado una zona horaria inexistente Cuando calculo la fecha contable Entonces Intl lanza (la config debe validarla antes, fail-fast)', () => {
    expect(() => fechaContable('2026-06-01T15:00:00.000Z', 'Martes/Ficticia')).toThrow();
  });

  it('Dado un instante inválido Cuando calculo la fecha contable Entonces lanza con mensaje explícito', () => {
    expect(() => fechaContable('no-es-fecha', 'America/Buenos_Aires')).toThrow(
      /inválido/,
    );
  });
});
