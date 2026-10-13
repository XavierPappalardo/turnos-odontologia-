/**
 * Runner de migraciones (design D4): registro ordenado + `runMigrations(db)`
 * idempotente sobre SQLite REAL en memoria (R12: sin mock de transacción).
 * Formaliza la migración base 001.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';
import { openDatabase } from '../src/shared/repository.js';

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
}

function appliedIds(db: DatabaseSync): string[] {
  return (
    db
      .prepare(`SELECT id FROM schema_migrations ORDER BY id`)
      .all() as { id: string }[]
  ).map((r) => r.id);
}

describe('runMigrations', () => {
  it('Dado BD nueva Cuando corro migraciones Entonces aplica 001 (tablas núcleo) y habilita FKs', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const applied = runMigrations(db);
      expect(applied).toContain('001');
      expect(tableNames(db)).toEqual(
        expect.arrayContaining([
          'profesional',
          'sillon',
          'paciente',
          'prestacion',
          'turno',
          'bloqueo',
          'schema_migrations',
        ]),
      );
      const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(fk.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });

  it('Dado BD ya migrada Cuando re-corro Entonces es idempotente (no falla ni duplica y no reaplica)', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const first = runMigrations(db);
      expect(first).toEqual(['001', '002', '003']);
      const before = tableNames(db);
      let second: readonly string[] = ['<sin-correr>'];
      expect(() => {
        second = runMigrations(db);
      }).not.toThrow();
      expect(second).toEqual([]);
      expect(tableNames(db)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('Dado runMigrations Cuando registro Entonces ids ordenados ascendente', () => {
    expect(MIGRATIONS.map((m) => m.id)).toEqual(['001', '002', '003']);
  });

  it('Dado openDatabase Cuando abro Entonces delega en el runner y registra 001→003', () => {
    const db = openDatabase(':memory:');
    try {
      expect(appliedIds(db)).toEqual(['001', '002', '003']);
    } finally {
      db.close();
    }
  });
});
