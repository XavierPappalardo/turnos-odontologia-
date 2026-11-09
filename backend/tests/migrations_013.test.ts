/**
 * Tests para la Migración 013: Precios Públicos en ARS (C-15).
 * Valida la existencia de la columna precio_base_centavos en prestacion,
 * su valor por defecto 0, el CHECK (precio_base_centavos >= 0),
 * y la idempotencia del runner de migraciones.
 * SQLite real en memoria (R12: sin mock de base ni transacciones).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  ).map((c) => c.name);
}

describe('Migración 013 — Precios Públicos en ARS (prestacion.precio_base_centavos)', () => {
  it('Dado el registro de migraciones Cuando se inspecciona Entonces existe migración 013', () => {
    const mig013 = MIGRATIONS.find((m) => m.id === '013');
    expect(mig013).toBeDefined();
    expect(mig013?.sql).toContain('precio_base_centavos');
  });

  it('Dado una base de datos nueva Cuando se ejecutan las migraciones Entonces prestacion tiene columna precio_base_centavos', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);

    const cols = columnasTabla(db, 'prestacion');
    expect(cols).toContain('precio_base_centavos');
    expect(cols).toContain('codigo');
    expect(cols).toContain('nombre');
    expect(cols).toContain('duracion_min');
  });

  it('Dado un registro sin precio explícito Cuando se inserta en prestacion Entonces el valor por defecto es 0', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);

    db.prepare(
      `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
       VALUES ('p-default', 'DEF-01', 'Prestación Default', 30, ?, ?)`,
    ).run(AHORA, AHORA);

    const row = db
      .prepare('SELECT precio_base_centavos FROM prestacion WHERE id = ?')
      .get('p-default') as { precio_base_centavos: number };

    expect(row.precio_base_centavos).toBe(0);
  });

  it('Dado un precio base positivo en centavos Cuando se inserta Entonces se almacena exactamente', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);

    db.prepare(
      `INSERT INTO prestacion (id, codigo, nombre, duracion_min, precio_base_centavos, created_at, updated_at)
       VALUES ('p-pos', 'POS-01', 'Limpieza Dental', 45, 1500000, ?, ?)`,
    ).run(AHORA, AHORA);

    const row = db
      .prepare('SELECT precio_base_centavos FROM prestacion WHERE id = ?')
      .get('p-pos') as { precio_base_centavos: number };

    expect(row.precio_base_centavos).toBe(1500000);
  });

  it('Dado un precio base negativo Cuando se intenta insertar Entonces falla el CHECK constraint', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);

    expect(() => {
      db.prepare(
        `INSERT INTO prestacion (id, codigo, nombre, duracion_min, precio_base_centavos, created_at, updated_at)
         VALUES ('p-neg', 'NEG-01', 'Inválida', 30, -500, ?, ?)`,
      ).run(AHORA, AHORA);
    }).toThrow();
  });

  it('Dado un registro existente Cuando se intenta actualizar a precio negativo Entonces falla el CHECK constraint', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);

    db.prepare(
      `INSERT INTO prestacion (id, codigo, nombre, duracion_min, precio_base_centavos, created_at, updated_at)
       VALUES ('p-upd', 'UPD-01', 'Actualizable', 30, 200000, ?, ?)`,
    ).run(AHORA, AHORA);

    expect(() => {
      db.prepare(
        'UPDATE prestacion SET precio_base_centavos = -1 WHERE id = ?',
      ).run('p-upd');
    }).toThrow();
  });

  it('Dado que las migraciones ya se ejecutaron Cuando se corre runMigrations nuevamente Entonces es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    const primera = runMigrations(db);
    expect(primera).toContain('013');

    const segunda = runMigrations(db);
    expect(segunda).toHaveLength(0);

    const cols = columnasTabla(db, 'prestacion');
    expect(cols).toContain('precio_base_centavos');
  });
});
