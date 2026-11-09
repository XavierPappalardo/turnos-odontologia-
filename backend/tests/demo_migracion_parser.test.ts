/**
 * C-20 parser/contrato de importación (BAJO). Fixtures ficticias, sin PHI.
 */
import { describe, expect, it } from 'vitest';
import { aplicarMapeo, parsearContenido } from '../src/utilidades/demo-migracion-excel/parser.js';

describe('C-20 demo-migracion-excel parser/contrato', () => {
  it('Dado CSV válido con encabezados Cuando parsea Entonces retorna filas normalizadas', async () => {
    const csv = 'nombre,matricula\nProfesional Ficticio Uno,MAT-F-1\nProfesional Ficticio Dos,MAT-F-2\n';
    const res = await parsearContenido('csv', csv);
    expect(res.errores).toHaveLength(0);
    expect(res.filas).toHaveLength(2);
    expect(res.filas[0]).toEqual({ fila: 1, datos: { nombre: 'Profesional Ficticio Uno', matricula: 'MAT-F-1' } });
  });

  it('Dado CSV inválido/vacío Cuando parsea Entonces retorna sin filas (resultado seguro)', async () => {
    const res = await parsearContenido('csv', 'solo-encabezado\n');
    expect(res.filas).toHaveLength(0);
  });

  it('Dado formato no soportado Cuando parsea Entonces rechaza con error tipado', async () => {
    await expect(parsearContenido('pdf' as any, 'x')).rejects.toMatchObject({ status: 400 });
  });

  it('Dado mapeo de columnas Cuando aplica Entonces normaliza campos destino', async () => {
    const csv = 'Nombre Completo,Mat\nProf Ficticio,M1\n';
    const { filas } = await parsearContenido('csv', csv);
    const mapeadas = aplicarMapeo(filas, { nombre: 'Nombre Completo', matricula: 'Mat' });
    expect(mapeadas[0].datos.nombre).toBe('Prof Ficticio');
    expect(mapeadas[0].datos.matricula).toBe('M1');
  });

  it('Dado CSV con comillas Cuando parsea Entonces maneja campos', async () => {
    const csv = 'nombre,nota\n"Profesional, Ficticio","ok"\n';
    const { filas } = await parsearContenido('csv', csv);
    expect(filas[0].datos.nombre).toBe('Profesional, Ficticio');
  });
});
