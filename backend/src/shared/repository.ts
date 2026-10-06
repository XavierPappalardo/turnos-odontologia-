/**
 * Capa de acceso a datos (R8): SOLO vía BaseRepository + UnitOfWork (+ AuditMixin).
 * Motor: node:sqlite (DatabaseSync). Sin ORMs (R7).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  MIGRATION_001_CORE,
  MIGRATION_002_AUTH,
  MIGRATION_003_TURNO_BLOQUEO,
} from './migrations.js';

export type { DatabaseSync };

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

/** Abre una BD nueva (fichero o ':memory:') y aplica 001→003. */
export function openDatabase(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATION_001_CORE);
  db.exec(MIGRATION_002_AUTH);
  db.exec(MIGRATION_003_TURNO_BLOQUEO);
  return db;
}

/** Aplica solo 003 sobre una BD existente (verificación de tarea 2.1). */
export function applyMigration003(db: DatabaseSync): void {
  db.exec(MIGRATION_003_TURNO_BLOQUEO);
}

export interface AuditRow {
  created_at: string;
  updated_at: string;
}

/** AuditMixin: sella created_at/updated_at en inserciones (C-02 [Supuesto]). */
export function auditStamp(): AuditRow {
  const now = nowIsoUtc();
  return { created_at: now, updated_at: now };
}

/**
 * Repositorio base genérico. Todo SQL vive en repositorios (R8):
 * el servicio y el endpoint NUNCA emiten SQL suelto.
 */
export class BaseRepository<T extends object> {
  protected readonly db: DatabaseSync;
  readonly table: string;

  constructor(db: DatabaseSync, table: string) {
    this.db = db;
    this.table = table;
  }

  insert(row: Omit<T, 'created_at' | 'updated_at'> & { id: string }): void {
    const stamp = auditStamp();
    const full: Record<string, SQLInputValue> = {
      ...(row as unknown as Record<string, SQLInputValue>),
      ...stamp,
    };
    const cols = Object.keys(full);
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders})`,
    );
    stmt.run(...cols.map((c) => full[c] as SQLInputValue));
  }

  findById(id: string): T | undefined {
    const stmt = this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`);
    return stmt.get(id) as T | undefined;
  }

  countAll(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table}`);
    const row = stmt.get() as { n: number };
    return row.n;
  }
}

/**
 * Unidad de trabajo transaccional (R9): toda escritura de turnos que
 * valide solapamiento va en `BEGIN IMMEDIATE` + consulta de intersección.
 */
export class UnitOfWork {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get database(): DatabaseSync {
    return this.db;
  }

  runInTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ya en rollback: conservar error original
      }
      throw err;
    }
  }
}
