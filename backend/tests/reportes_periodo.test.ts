/**
 * Task 1.1/1.3: `periodo.ts` — validación de rango y bucketing temporal puro (C-14).
 *
 * Escenarios de unidad pura (sin base de datos, sin configuración): validación
 * `YYYY-MM-DD` real, tope de 366 días inclusive, granularidades `dia|semana|mes`
 * y claves de grupo con semana ISO-8601 (lunes primero, cambio de año).
 *
 * `validarRango` devuelve una unión discriminada (`ok: true | false`), nunca
 * lanza: la ruta (task 8.x) la traduce a `ReportesError` y los servicios a su
 * error tipado. Ver JSDoc del módulo.
 */
import { describe, expect, it } from 'vitest';
import {
  claveDeGrupo,
  claveSemanaIso,
  diasEntre,
  esFechaLocalValida,
  validarRango,
  ventanaUtcGruesa,
} from '../src/reportes/periodo.js';

describe('periodo.ts — fechas locales (task 1.1)', () => {
  it('Dado "2026-11-01" Cuando valido la fecha local Entonces es válida', () => {
    expect(esFechaLocalValida('2026-11-01')).toBe(true);
  });

  it('Dado "01-11-2026" Cuando valido la fecha local Entonces es inválida (formato equivocado)', () => {
    expect(esFechaLocalValida('01-11-2026')).toBe(false);
  });

  it('Dado "2026-02-31" Cuando valido la fecha local Entonces es inválida (día inexistente)', () => {
    expect(esFechaLocalValida('2026-02-31')).toBe(false);
  });

  it('Dado un string vacío Cuando valido la fecha local Entonces es inválida', () => {
    expect(esFechaLocalValida('')).toBe(false);
  });

  it('Dado "2024-02-29" Cuando valido la fecha local Entonces es válida (bisiesto)', () => {
    expect(esFechaLocalValida('2024-02-29')).toBe(true);
  });

  it('Dado "2026-13-01" Cuando valido la fecha local Entonces es inválida (mes inexistente)', () => {
    expect(esFechaLocalValida('2026-13-01')).toBe(false);
  });
});

describe('periodo.ts — días entre fechas', () => {
  it('Dado el mismo día Cuando cuento días Entonces el rango inclusivo es 1', () => {
    expect(diasEntre('2026-11-01', '2026-11-01')).toBe(1);
  });

  it('Dado 2026-11-01..2026-11-07 Cuando cuento días Entonces el rango inclusivo es 7', () => {
    expect(diasEntre('2026-11-01', '2026-11-07')).toBe(7);
  });
});

describe('periodo.ts — validarRango (task 1.1)', () => {
  it('Dado desde <= hasta de 7 días Cuando valido Entonces es válido', () => {
    const resultado = validarRango('2026-11-01', '2026-11-07', 'dia');
    expect(resultado.ok).toBe(true);
  });

  it('Dado un rango de exactamente 366 días inclusive Cuando valido Entonces es válido', () => {
    expect(diasEntre('2025-11-01', '2026-11-01')).toBe(366);
    const resultado = validarRango('2025-11-01', '2026-11-01', 'dia');
    expect(resultado.ok).toBe(true);
  });

  it('Dado un rango de 367 días Cuando valido Entonces es inválido por rango', () => {
    expect(diasEntre('2025-11-01', '2026-11-02')).toBe(367);
    const resultado = validarRango('2025-11-01', '2026-11-02', 'dia');
    expect(resultado).toMatchObject({ ok: false, campo: 'rango' });
  });

  it('Dado desde posterior a hasta Cuando valido Entonces es inválido por rango', () => {
    const resultado = validarRango('2026-11-10', '2026-11-01', 'dia');
    expect(resultado).toMatchObject({ ok: false, campo: 'rango' });
  });

  it('Dado desde con formato inválido Cuando valido Entonces es inválido por el campo desde', () => {
    const resultado = validarRango('01-11-2026', '2026-11-07', 'dia');
    expect(resultado).toMatchObject({ ok: false, campo: 'desde' });
  });

  it('Dado hasta inexistente Cuando valido Entonces es inválido por el campo hasta', () => {
    const resultado = validarRango('2026-11-01', '2026-02-31', 'dia');
    expect(resultado).toMatchObject({ ok: false, campo: 'hasta' });
  });

  it('Dado granularidad fuera de las tres Cuando valido Entonces es inválido por granularidad', () => {
    const resultado = validarRango('2026-11-01', '2026-11-07', 'trimestre');
    expect(resultado).toMatchObject({ ok: false, campo: 'granularidad' });
  });

  it('Dado granularidad omitida Cuando valido Entonces cae en "dia"', () => {
    const resultado = validarRango('2026-11-01', '2026-11-07', undefined);
    expect(resultado).toMatchObject({ ok: true, granularidad: 'dia' });
  });
});

describe('periodo.ts — claves de grupo (task 1.3)', () => {
  it('Dado el lunes 2026-11-02 Cuando calculo la clave semanal Entonces es 2026-W45', () => {
    expect(claveSemanaIso('2026-11-02')).toBe('2026-W45');
  });

  it('Dado 2026-12-31 y 2027-01-01 Cuando calculo la clave semanal Entonces ambos caen en 2026-W53', () => {
    expect(claveSemanaIso('2026-12-31')).toBe('2026-W53');
    expect(claveSemanaIso('2027-01-01')).toBe('2026-W53');
  });

  it('Dado 2026-01-01 Cuando calculo la clave semanal Entonces es 2026-W01 (semana que inicia el 2025-12-29)', () => {
    expect(claveSemanaIso('2026-01-01')).toBe('2026-W01');
  });

  it('Dado un lunes y el domingo siguiente Cuando calculo la clave semanal Entonces comparten clave', () => {
    expect(claveSemanaIso('2026-11-02')).toBe(claveSemanaIso('2026-11-08'));
  });

  it('Dado un domingo y el lunes siguiente Cuando calculo la clave semanal Entonces no comparten clave', () => {
    expect(claveSemanaIso('2026-11-08')).not.toBe(claveSemanaIso('2026-11-09'));
  });

  it('Dado una fecha local Cuando calculo la clave diaria Entonces es la misma fecha', () => {
    expect(claveDeGrupo('2026-11-01', 'dia')).toBe('2026-11-01');
  });

  it('Dado una fecha local Cuando calculo la clave mensual Entonces es YYYY-MM', () => {
    expect(claveDeGrupo('2026-11-15', 'mes')).toBe('2026-11');
    expect(claveDeGrupo('2026-12-31', 'mes')).toBe('2026-12');
  });

  it('Dado una fecha local Cuando calculo la clave semanal Entonces delega en claveSemanaIso', () => {
    expect(claveDeGrupo('2026-11-02', 'semana')).toBe('2026-W45');
  });
});

describe('periodo.ts — ventana gruesa UTC (design D4)', () => {
  it('Dado el rango local 2026-11-01..2026-11-07 Cuando calculo la ventana gruesa Entonces cubre desde un día antes y hasta dos días después a las 00:00Z', () => {
    expect(ventanaUtcGruesa('2026-11-01', '2026-11-07')).toEqual({
      desdeUtc: '2026-10-31T00:00:00.000Z',
      hastaUtc: '2026-11-09T00:00:00.000Z',
    });
  });

  it('Dado el borde del año Cuando calculo la ventana gruesa Entonces la aritmética cruza correctamente', () => {
    expect(ventanaUtcGruesa('2026-12-31', '2026-12-31')).toEqual({
      desdeUtc: '2026-12-30T00:00:00.000Z',
      hastaUtc: '2027-01-02T00:00:00.000Z',
    });
  });
});
