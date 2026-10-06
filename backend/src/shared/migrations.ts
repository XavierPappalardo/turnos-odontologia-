/**
 * Migraciones SQLite gestionadas (R7/R8).
 * 001 = core mínimo (C-02 [Supuesto] equivalente dentro del alcance de C-04).
 * 002 = auth mínima (C-03 [Supuesto] equivalente: users + roles).
 * 003 = turno + bloqueo del change (C-04).
 * Montos: no hay montos en este change (R2/R5 N/A, sin floats).
 */
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
