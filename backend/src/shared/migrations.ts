/**
 * Migraciones SQLite gestionadas (R7/R8).
 * 001 = core mínimo (base formalizada por C-01; C-02 la completa).
 * 002 = auth mínima (C-03 [Supuesto] equivalente: users + roles).
 * 003 = turno + bloqueo del change (C-04).
 * Montos: no hay montos en este change (R2/R5 N/A, sin floats).
 */
import type { DatabaseSync } from 'node:sqlite';

export const MIGRATION_001_CORE = `
CREATE TABLE IF NOT EXISTS profesional (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  matricula TEXT UNIQUE,
  especialidad TEXT,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sillon (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paciente (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  telefono_whatsapp TEXT,
  obra_social_plan_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prestacion (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  duracion_min INTEGER NOT NULL CHECK (duracion_min > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const MIGRATION_002_AUTH = `
CREATE TABLE IF NOT EXISTS usuario (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usuario_rol (
  usuario_id TEXT NOT NULL REFERENCES usuario(id),
  rol TEXT NOT NULL CHECK (rol IN ('recepcion', 'profesional', 'administracion')),
  PRIMARY KEY (usuario_id, rol)
);
`;

export const MIGRATION_003_TURNO_BLOQUEO = `
CREATE TABLE IF NOT EXISTS turno (
  id TEXT PRIMARY KEY,
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  sillon_id TEXT NOT NULL REFERENCES sillon(id),
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  prestacion_id TEXT REFERENCES prestacion(id),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL CHECK (fin > inicio),
  estado TEXT NOT NULL DEFAULT 'reservado'
    CHECK (estado IN ('reservado', 'confirmado', 'presente', 'atendido', 'cancelado', 'ausente')),
  origen TEXT NOT NULL DEFAULT 'recepcion'
    CHECK (origen IN ('recepcion', 'online', 'whatsapp')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bloqueo (
  id TEXT PRIMARY KEY,
  profesional_id TEXT REFERENCES profesional(id),
  sillon_id TEXT REFERENCES sillon(id),
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL CHECK (fin > inicio),
  motivo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turno_prof_intervalo
  ON turno(profesional_id, inicio, fin);
CREATE INDEX IF NOT EXISTS idx_turno_sillon_intervalo
  ON turno(sillon_id, inicio, fin);
CREATE INDEX IF NOT EXISTS idx_bloqueo_aplicabilidad
  ON bloqueo(profesional_id, sillon_id, inicio, fin);
`;

/** Una migración versionada: id ascendente + SQL idempotente (`IF NOT EXISTS`). */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/**
 * Registro ordenado de migraciones (design D4). La migración base 001 crea las
 * tablas núcleo. El orden del array ES el orden de aplicación.
 */
export const MIGRATIONS: readonly Migration[] = [
  { id: '001', sql: MIGRATION_001_CORE },
  { id: '002', sql: MIGRATION_002_AUTH },
  { id: '003', sql: MIGRATION_003_TURNO_BLOQUEO },
];

/** Tabla de control de migraciones aplicadas (idempotencia). */
export const MIGRATIONS_CONTROL_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

function appliedMigrationIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT id FROM schema_migrations')
    .all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Aplica una migración puntual por id (delegación usada por `applyMigration003`).
 * Idempotente por `IF NOT EXISTS`; no toca `schema_migrations` (uso de bajo nivel).
 */
export function applyMigration(db: DatabaseSync, id: string): void {
  const migration = MIGRATIONS.find((m) => m.id === id);
  if (migration === undefined) {
    throw new Error(`migración desconocida: ${id}`);
  }
  db.exec(migration.sql);
}

/**
 * Runner de migraciones (design D4): habilita `foreign_keys` + `journal_mode=WAL`,
 * crea la tabla de control `schema_migrations` y aplica, en orden ascendente y de
 * forma idempotente dentro de una transacción, las migraciones pendientes.
 * Devuelve los ids aplicados en esta corrida (vacío si no había pendientes).
 */
export function runMigrations(db: DatabaseSync): readonly string[] {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(MIGRATIONS_CONTROL_TABLE);

  const applied = appliedMigrationIds(db);
  const insert = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );
  const newlyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      insert.run(migration.id, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ya en rollback: conservar error original
      }
      throw err;
    }
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}

