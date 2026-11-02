/**
 * C-09 task 3.1: Dominio FDI - pruebas table-driven.
 * Piezas válidas: permanentes 11-48, temporales 51-85.
 * Piezas inválidas: 19, 49, 00, 86.
 * Superficies válidas: M, D, V, L, O, I.
 * Superficies inválidas: cualquier otra.
 */
import { describe, expect, it } from 'vitest';
import {
  esCombinacionValida,
  esPiezaFdiValida,
  esSuperficieValida,
  PIEZAS_VALIDAS_ARRAY,
} from '../src/clinica/fdi.js';

describe('esPiezaFdiValida', () => {
  it.each([
    // Permanentes válidos
    11, 12, 13, 14, 15, 16, 17, 18,
    21, 22, 23, 24, 25, 26, 27, 28,
    31, 32, 33, 34, 35, 36, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48,
    // Temporales válidos (5 por cuadrante: 51-55, 61-65, 71-75, 81-85)
    51, 52, 53, 54, 55,
    61, 62, 63, 64, 65,
    71, 72, 73, 74, 75,
    81, 82, 83, 84, 85,
  ])('Dado pieza %i Cuando valida Entonces es FDI válida', (pieza) => {
    expect(esPiezaFdiValida(pieza)).toBe(true);
  });

  it.each([19, 49, 0, 86, 100, -1, 50, 56, 57, 58, 59, 60, 66, 67, 68, 69, 70, 76, 77, 78, 79, 80, 87, 90])(
    'Dado pieza %i Cuando valida Entonces NO es FDI válida',
    (pieza) => {
      expect(esPiezaFdiValida(pieza)).toBe(false);
    },
  );
});

describe('esSuperficieValida', () => {
  it.each(['M', 'D', 'V', 'L', 'O', 'I'])(
    'Dado superficie %s Cuando valida Entonces es válida',
    (superficie) => {
      expect(esSuperficieValida(superficie)).toBe(true);
    },
  );

  it.each(['X', 'Z', 'A', 'B', 'C', '', 'm', 'o', 'i'])(
    'Dado superficie %s Cuando valida Entonces NO es válida',
    (superficie) => {
      expect(esSuperficieValida(superficie)).toBe(false);
    },
  );
});

describe('esCombinacionValida - triangulación', () => {
  it('Dado I en incisivo permanente Cuando valida Entonces es válida', () => {
    expect(esCombinacionValida(11, 'I')).toBe(true);
    expect(esCombinacionValida(12, 'I')).toBe(true);
    expect(esCombinacionValida(13, 'I')).toBe(true);
  });

  it('Dado I en canino permanente Cuando valida Entonces es válida', () => {
    expect(esCombinacionValida(23, 'I')).toBe(true);
    expect(esCombinacionValida(33, 'I')).toBe(true);
    expect(esCombinacionValida(43, 'I')).toBe(true);
  });

  it('Dado I en molar permanente Cuando valida Entonces NO es válida', () => {
    expect(esCombinacionValida(16, 'I')).toBe(false);
    expect(esCombinacionValida(26, 'I')).toBe(false);
    expect(esCombinacionValida(36, 'I')).toBe(false);
    expect(esCombinacionValida(46, 'I')).toBe(false);
  });

  it('Dado O en molar permanente Cuando valida Entonces es válida', () => {
    expect(esCombinacionValida(16, 'O')).toBe(true);
    expect(esCombinacionValida(26, 'O')).toBe(true);
    expect(esCombinacionValida(36, 'O')).toBe(true);
    expect(esCombinacionValida(46, 'O')).toBe(true);
  });

  it('Dado O en premolar permanente Cuando valida Entonces es válida', () => {
    expect(esCombinacionValida(14, 'O')).toBe(true);
    expect(esCombinacionValida(24, 'O')).toBe(true);
    expect(esCombinacionValida(34, 'O')).toBe(true);
    expect(esCombinacionValida(44, 'O')).toBe(true);
  });

  it('Dado O en incisivo permanente Cuando valida Entonces NO es válida', () => {
    expect(esCombinacionValida(11, 'O')).toBe(false);
    expect(esCombinacionValida(12, 'O')).toBe(false);
    expect(esCombinacionValida(21, 'O')).toBe(false);
    expect(esCombinacionValida(22, 'O')).toBe(false);
  });

  it('Dado O en molar temporal 55 Cuando valida Entonces es válida', () => {
    expect(esCombinacionValida(55, 'O')).toBe(true);
  });

  it('Dado O en incisivo temporal 52 Cuando valida Entonces NO es válida', () => {
    expect(esCombinacionValida(52, 'O')).toBe(false);
  });

  it('Dado M/D/V/L en cualquier pieza válida Cuando valida Entonces es válida', () => {
    for (const pieza of PIEZAS_VALIDAS_ARRAY) {
      for (const superficie of ['M', 'D', 'V', 'L']) {
        expect(esCombinacionValida(pieza, superficie)).toBe(true);
      }
    }
  });

  it('Dado todas las piezas FDI válidas Cuando cuenta Entonces son 52', () => {
    expect(PIEZAS_VALIDAS_ARRAY.length).toBe(52);
  });
});

