/**
 * Task 3.1: repositorios de configuración de comisiones (C-13).
 * SQLite REAL en memoria (R12: sin mocks de base ni de transacción);
 * datos estrictamente ficticios (R1/R12).
 * Cobertura: upsert idempotente contra los índices parciales de 012,
 * baja lógica que libera la unicidad, FK del DDL y orden canónico.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import {
  ProfesionalComisionRepository,
  ProfesionalComisionTratamientoRepository,
} from '../src/comisiones/config.repository.js';

const AHORA = new Date().toISOString();

function sembrar(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Odontologo Ficticio Uno', 'MN-1111', 'Odontología', 1, ?, ?),
            ('prof-2', 'Odontologo Ficticio Dos', 'MN-2222', 'Odontología', 1, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-1', 'CONS-01', 'Consulta Ficticia', 30, ?, ?),
            ('pres-2', 'RES-02', 'Restauracion Ficticia', 60, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
}

describe('comisiones/config.repository (C-13, task 3.1)', () => {
  let db: DatabaseSync;
  let comisiones: ProfesionalComisionRepository;
  let tratamientos: ProfesionalComisionTratamientoRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrar(db);
    comisiones = new ProfesionalComisionRepository(db);
    tratamientos = new ProfesionalComisionTratamientoRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado profesional sin config Cuando upsert Entonces crea la config vigente con el pct y auditoría de 012', () => {
    const fila = comisiones.upsert({ profesionalId: 'prof-1', pctGeneral: 20 });
    expect(fila).toBeDefined();
    expect(fila!.profesional_id).toBe('prof-1');
    expect(fila!.pct_general).toBe(20);
    expect(fila!.deleted_at).toBeNull();
    expect(fila!.created_at).toEqual(fila!.updated_at);
    expect(comisiones.obtenerConfigVigente('prof-1')).toEqual(fila);
  });

  it('Dado config vigente Cuando upsert con otro pct Entonces conserva el mismo id y actualiza el pct sin duplicar fila', () => {
    const primera = comisiones.upsert({ profesionalId: 'prof-1', pctGeneral: 20 });
    const segunda = comisiones.upsert({ profesionalId: 'prof-1', pctGeneral: 30 });
    expect(segunda!.id).toBe(primera!.id);
    expect(segunda!.pct_general).toBe(30);
    expect(comisiones.countAll()).toBe(1);
  });

  it('Dado config dada de baja lógica Cuando upsert Entonces crea una fila nueva vigente (el índice parcial libera)', () => {
    const primera = comisiones.upsert({ profesionalId: 'prof-1', pctGeneral: 20 });
    expect(comisiones.softDelete(primera!.id)).toBe(true);
    expect(comisiones.obtenerConfigVigente('prof-1')).toBeUndefined();
    const nueva = comisiones.upsert({ profesionalId: 'prof-1', pctGeneral: 40 });
    expect(nueva).toBeDefined();
    expect(nueva!.id).not.toBe(primera!.id);
    expect(nueva!.pct_general).toBe(40);
    expect(comisiones.countAll()).toBe(2);
    expect(comisiones.obtenerConfigVigente('prof-1')!.id).toBe(nueva!.id);
  });

  it('Dado profesional inexistente Cuando upsert Entonces la FK de 012 rechaza', () => {
    expect(() =>
      comisiones.upsert({ profesionalId: 'prof-404', pctGeneral: 10 }),
    ).toThrow();
  });

  it('Dado par sin config Cuando upsert por tratamiento Entonces queda vigente y listarVigentes lo devuelve', () => {
    const fila = tratamientos.upsert({
      profesionalId: 'prof-1',
      prestacionId: 'pres-1',
      pct: 50,
    });
    expect(fila).toBeDefined();
    expect(fila!.pct).toBe(50);
    expect(tratamientos.obtenerVigentePorPrestacion('prof-1', 'pres-1')!.id).toBe(
      fila!.id,
    );
    expect(tratamientos.listarVigentes('prof-1').map((t) => t.prestacion_id)).toEqual([
      'pres-1',
    ]);
  });

  it('Dado mismo par vigilante Cuando upsert dos veces con pct distinto Entonces actualiza sin duplicar (índice parcial)', () => {
    const primera = tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-1', pct: 50 });
    const segunda = tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-1', pct: 35 });
    expect(segunda!.id).toBe(primera!.id);
    expect(segunda!.pct).toBe(35);
    expect(tratamientos.countAll()).toBe(1);
  });

  it('Dado varios pares Cuando listarVigentes Entonces orden canónico por prestacion_id, sin mezclar profesionales (orden para fingerprint D13)', () => {
    tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-2', pct: 30 });
    tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-1', pct: 25 });
    tratamientos.upsert({ profesionalId: 'prof-2', prestacionId: 'pres-1', pct: 10 });
    expect(
      tratamientos.listarVigentes('prof-1').map((t) => t.prestacion_id),
    ).toEqual(['pres-1', 'pres-2']);
    expect(tratamientos.listarVigentes('prof-2').map((t) => t.pct)).toEqual([10]);
  });

  it('Dado config por tratamiento vigente Cuando desactivar Entonces baja lógica y permite re-crear el par', () => {
    const fila = tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-1', pct: 50 });
    expect(tratamientos.desactivar(fila!.id)).toBe(true);
    expect(tratamientos.desactivar(fila!.id)).toBe(false);
    expect(tratamientos.obtenerVigentePorPrestacion('prof-1', 'pres-1')).toBeUndefined();
    const reCreada = tratamientos.upsert({ profesionalId: 'prof-1', prestacionId: 'pres-1', pct: 60 });
    expect(reCreada).toBeDefined();
    expect(reCreada!.id).not.toBe(fila!.id);
    expect(tratamientos.countAll()).toBe(2);
  });
});
