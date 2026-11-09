/**
 * Tests para PrestacionRepository (C-15).
 * Valida listarActivas, obtenerPorId y actualizarPrecio con SQLite en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrestacionRepository } from '../src/catalogo/prestacion.repository.js';
import { runMigrations } from '../src/shared/migrations.js';

describe('PrestacionRepository — Acceso a datos de catálogo y precios', () => {
  let db: DatabaseSync;
  let repo: PrestacionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    repo = new PrestacionRepository(db);
  });

  it('Dado prestaciones en base Cuando lista activas Entonces retorna solo las activas con precio', () => {
    repo.insert({
      id: 'p-1',
      codigo: 'CONS',
      nombre: 'Consulta General',
      duracion_min: 30,
      precio_base_centavos: 1000000,
      activo: 1,
      deleted_at: null,
    });
    repo.insert({
      id: 'p-2',
      codigo: 'LIMPIEZA',
      nombre: 'Limpieza y Profilaxis',
      duracion_min: 45,
      precio_base_centavos: 2500000,
      activo: 1,
      deleted_at: null,
    });
    repo.insert({
      id: 'p-inactiva',
      codigo: 'INACT',
      nombre: 'Prestación Inactiva',
      duracion_min: 60,
      precio_base_centavos: 5000000,
      activo: 0,
      deleted_at: null,
    });

    const activas = repo.listarActivas();
    expect(activas).toHaveLength(2);
    expect(activas.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(activas[0].precio_base_centavos).toBe(1000000);
    expect(activas[1].precio_base_centavos).toBe(2500000);
  });

  it('Dado un id existente Cuando busca por id Entonces retorna la prestación con su precio', () => {
    repo.insert({
      id: 'p-buscada',
      codigo: 'EXT',
      nombre: 'Extracción Simple',
      duracion_min: 40,
      precio_base_centavos: 3500000,
      activo: 1,
      deleted_at: null,
    });

    const encontrada = repo.obtenerPorId('p-buscada');
    expect(encontrada).toBeDefined();
    expect(encontrada?.nombre).toBe('Extracción Simple');
    expect(encontrada?.precio_base_centavos).toBe(3500000);
  });

  it('Dado un id inexistente Cuando busca por id Entonces retorna undefined', () => {
    expect(repo.obtenerPorId('no-existe')).toBeUndefined();
  });

  it('Dado una prestación existente Cuando se actualiza su precio base Entonces persiste el nuevo valor y actualiza updated_at', () => {
    repo.insert({
      id: 'p-mod',
      codigo: 'BLANC',
      nombre: 'Blanqueamiento Dental',
      duracion_min: 60,
      precio_base_centavos: 4000000,
      activo: 1,
      deleted_at: null,
    });

    const original = repo.obtenerPorId('p-mod');
    const actualizado = repo.actualizarPrecio('p-mod', 5500000);

    expect(actualizado).toBeDefined();
    expect(actualizado?.precio_base_centavos).toBe(5500000);
    expect(actualizado?.updated_at).toBeDefined();

    const leido = repo.obtenerPorId('p-mod');
    expect(leido?.precio_base_centavos).toBe(5500000);
  });

  it('Dado un monto negativo Cuando se intenta actualizar el precio Entonces arroja error de validación', () => {
    repo.insert({
      id: 'p-val',
      codigo: 'ENDO',
      nombre: 'Endodoncia Unirradicular',
      duracion_min: 90,
      precio_base_centavos: 6000000,
      activo: 1,
      deleted_at: null,
    });

    expect(() => repo.actualizarPrecio('p-val', -500)).toThrow();
  });

  it('Dado un id inexistente Cuando se intenta actualizar el precio Entonces retorna undefined', () => {
    const res = repo.actualizarPrecio('inexistente', 100000);
    expect(res).toBeUndefined();
  });
});
