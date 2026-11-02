/**
 * Task 1.2: Migración 009 - tablas presupuesto e item_presupuesto.
 * SQLite REAL en memoria (R12: sin mock de transacción).
 * Datos estrictamente ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  ).map((c) => c.name);
}

function fksTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA foreign_key_list(${tabla})`).all() as { table: string }[]
  ).map((fk) => fk.table);
}

function checksTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
      )
      .get(tabla) as { sql: string }
  ).sql.match(/CHECK\s*\([^)]+\)/gi) ?? [];
}

describe('Migración 009 - presupuesto y item_presupuesto', () => {
  it('Dado MIGRATIONS Cuando lista migraciones Entonces incluye 009 al final', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain('009');
    expect(ids[ids.length - 1]).toBe('009');
  });

  it('Dado BD nueva Cuando corro migraciones 001→009 Entonces crean presupuesto e item_presupuesto', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('presupuesto','item_presupuesto')`,
          )
          .all(),
      ).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('Dado tabla presupuesto Cuando inspecciono schema Entonces tiene columnas esperadas', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const cols = columnasTabla(db, 'presupuesto');
      expect(cols).toContain('id');
      expect(cols).toContain('paciente_id');
      expect(cols).toContain('turno_id');
      expect(cols).toContain('estado');
      expect(cols).toContain('total_centavos');
      expect(cols).toContain('cobertura_centavos');
      expect(cols).toContain('saldo_centavos');
      expect(cols).toContain('obra_social_plan_id');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
    } finally {
      db.close();
    }
  });

  it('Dado tabla presupuesto Cuando inspecciono FKs Entonces referencia paciente, turno, obra_social_plan', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const fks = fksTabla(db, 'presupuesto');
      expect(fks).toContain('paciente');
      expect(fks).toContain('turno');
      expect(fks).toContain('obra_social_plan');
    } finally {
      db.close();
    }
  });

  it('Dado tabla presupuesto Cuando inserto monto negativo Entonces CHECK rechaza', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      db.prepare(
        `INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', 't', 't')`,
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at) VALUES ('p1', 'pac-1', 'borrador', -5000, 0, -5000, 't', 't')`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('Dado tabla item_presupuesto Cuando inspecciono columnas Tiene monto_centavos, pieza_fdi, superficie', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const cols = columnasTabla(db, 'item_presupuesto');
      expect(cols).toContain('id');
      expect(cols).toContain('presupuesto_id');
      expect(cols).toContain('descripcion');
      expect(cols).toContain('monto_centavos');
      expect(cols).toContain('pieza_fdi');
      expect(cols).toContain('superficie');
      expect(cols).toContain('created_at');
      expect(cols).toContain('deleted_at');
    } finally {
      db.close();
    }
  });

  it('Dado tabla item_presupuesto Cuando inserto monto negativo Entonces CHECK rechaza', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      db.prepare(
        `INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', 't', 't')`,
      ).run();
      db.prepare(
        `INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at) VALUES ('p1', 'pac-1', 'borrador', 10000, 0, 10000, 't', 't')`,
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO item_presupuesto (id, presupuesto_id, descripcion, monto_centavos, created_at) VALUES ('i1', 'p1', 'Item Ficticio', -100, 't')`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('Dado tabla item_presupuesto Cuando inspecciono FKs Entonces referencia presupuesto', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const fks = fksTabla(db, 'item_presupuesto');
      expect(fks).toContain('presupuesto');
    } finally {
      db.close();
    }
  });
});
