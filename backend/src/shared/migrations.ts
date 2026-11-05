/**
 * Migraciones SQLite gestionadas (R7/R8).
 * 001 = core mínimo (base formalizada por C-01; C-02 la completa).
 * 002 = auth mínima (C-03: usuarios + roles).
 * 003 = turno + bloqueo (C-04).
 * 004 = completitud de core-models (C-02): obra social, pagos, auditoría.
 * 005 = refresh tokens + blacklist/rotación (C-03).
 * 009 = presupuestos e ítems (C-10).
 * 010 = caja: pago ampliado (aplicación, idempotencia, anulación) +
 *        movimiento_caja (append-only) + cierre_caja (C-11).
 * 011 = obras sociales: cobertura por turno, liquidación (cabecera/ítems/eventos) (C-12).
 * Montos: enteros en centavos (R2/R5), sin floats.
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

/**
 * 004 — completitud de C-02.
 * Agrega las entidades que faltaban (obra social y pago) y completa la
 * auditoría (`deleted_at`/`activo`) sin reescribir las migraciones ya emitidas.
 * Nota: SQLite no permite agregar FKs con ALTER TABLE; `paciente.obra_social_plan_id`
 * queda como FK lógica validada por la capa de repositorios (R8).
 */
export const MIGRATION_004_CORE_COMPLETE = `
CREATE TABLE IF NOT EXISTS obra_social_plan (
  id TEXT PRIMARY KEY,
  obra_social TEXT NOT NULL,
  plan TEXT NOT NULL,
  cobertura_pct INTEGER NOT NULL
    CHECK (cobertura_pct BETWEEN 0 AND 100)
    CHECK (cobertura_pct = CAST(cobertura_pct AS INTEGER)),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (obra_social, plan)
);
CREATE TABLE IF NOT EXISTS pago (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  monto_centavos INTEGER NOT NULL
    CHECK (monto_centavos >= 0)
    CHECK (monto_centavos = CAST(monto_centavos AS INTEGER)),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  medio TEXT NOT NULL
    CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'obra_social')),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'cobrado', 'anulado')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
ALTER TABLE profesional ADD COLUMN deleted_at TEXT;
ALTER TABLE sillon ADD COLUMN deleted_at TEXT;
ALTER TABLE paciente ADD COLUMN activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1));
ALTER TABLE paciente ADD COLUMN deleted_at TEXT;
ALTER TABLE prestacion ADD COLUMN activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1));
ALTER TABLE prestacion ADD COLUMN deleted_at TEXT;
ALTER TABLE turno ADD COLUMN deleted_at TEXT;
ALTER TABLE bloqueo ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_pago_turno ON pago(turno_id);
CREATE INDEX IF NOT EXISTS idx_paciente_os ON paciente(obra_social_plan_id);
`;

/** 005 — refresh tokens con rotación y blacklist (C-03). */
export const MIGRATION_005_AUTH_TOKENS = `
CREATE TABLE IF NOT EXISTS refresh_token (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_usuario ON refresh_token(usuario_id);
CREATE INDEX IF NOT EXISTS idx_refresh_vigente ON refresh_token(token_hash, revoked_at, expires_at);
ALTER TABLE usuario ADD COLUMN deleted_at TEXT;
`;

/** 006 — tokens de acción de turno (C-06: confirmar/cancelar/reprogramar). */
export const MIGRATION_006_TURNO_TOKEN = `
CREATE TABLE IF NOT EXISTS turno_token (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  token_hash TEXT NOT NULL UNIQUE,
  accion TEXT NOT NULL CHECK (accion IN ('confirmar', 'cancelar', 'reprogramar')),
  expires_at TEXT NOT NULL,
  usado_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turno_token_turno ON turno_token(turno_id);
CREATE INDEX IF NOT EXISTS idx_turno_token_valido ON turno_token(token_hash, usado_en, expires_at);
`;

/** 007 — recordatorios automáticos de turno (C-07). */
export const MIGRATION_007_RECORDATORIO = `
CREATE TABLE IF NOT EXISTS recordatorio (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('recordatorio_48h', 'recordatorio_24h')),
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  programado_para TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'cancelado')),
  enviado_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordatorio_estado_fecha ON recordatorio(estado, programado_para);
CREATE INDEX IF NOT EXISTS idx_recordatorio_turno_tipo ON recordatorio(turno_id, tipo);
`;

/** 009 — presupuestos e ítems de presupuesto (C-10). */
export const MIGRATION_009_PRESUPUESTOS = `
CREATE TABLE IF NOT EXISTS presupuesto (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  turno_id TEXT REFERENCES turno(id),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviado', 'aceptado', 'rechazado', 'vencido')),
  total_centavos INTEGER NOT NULL DEFAULT 0 CHECK (total_centavos >= 0),
  cobertura_centavos INTEGER NOT NULL DEFAULT 0 CHECK (cobertura_centavos >= 0),
  saldo_centavos INTEGER NOT NULL DEFAULT 0 CHECK (saldo_centavos >= 0),
  obra_social_plan_id TEXT REFERENCES obra_social_plan(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS item_presupuesto (
  id TEXT PRIMARY KEY,
  presupuesto_id TEXT NOT NULL REFERENCES presupuesto(id),
  descripcion TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos >= 0),
  pieza_fdi INTEGER,
  superficie TEXT CHECK (superficie IN ('M','D','V','L','O','I')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_presupuesto_paciente ON presupuesto(paciente_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_estado ON presupuesto(estado);
CREATE INDEX IF NOT EXISTS idx_item_presupuesto ON item_presupuesto(presupuesto_id);
`;

/**
 * 010 — caja (C-11, design D1/D3/D4): recomposición de `pago` + tablas de caja.
 * SQLite no admite ALTER de CHECK/FK → rebuild de `pago` (tabla nueva → copia de
 * filas previas preservando id/turno/montos/medios/estados/auditoría →
 * DROP/RENAME → recreación de índices). `turno_id` pasa a nullable, se suma
 * `presupuesto_id` FK con CHECK de aplicación obligatoria, `clave_idempotencia`
 * UNIQUE parcial, `referencia`, `actor_usuario_id`, `anulado_por_usuario_id`,
 * `motivo_anulacion`, `anulado_en`. Los CHECK previos de monto/moneda/medio/
 * estado se conservan (R2/R5). `movimiento_caja` es append-only (solo
 * `created_at`, triggers insert-only al estilo de `auditoria_phi` de 008);
 * `cierre_caja` es snapshot UNIQUE por fecha contable, también insert-only.
 */
export const MIGRATION_010_CAJA = `
CREATE TABLE IF NOT EXISTS pago_nuevo_010 (
  id TEXT PRIMARY KEY,
  turno_id TEXT REFERENCES turno(id),
  presupuesto_id TEXT REFERENCES presupuesto(id),
  monto_centavos INTEGER NOT NULL
    CHECK (monto_centavos >= 0)
    CHECK (monto_centavos = CAST(monto_centavos AS INTEGER)),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  medio TEXT NOT NULL
    CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'obra_social')),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'cobrado', 'anulado')),
  clave_idempotencia TEXT,
  referencia TEXT,
  actor_usuario_id TEXT REFERENCES usuario(id),
  anulado_por_usuario_id TEXT REFERENCES usuario(id),
  motivo_anulacion TEXT,
  anulado_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (turno_id IS NOT NULL OR presupuesto_id IS NOT NULL)
);
INSERT INTO pago_nuevo_010 (
    id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado,
    clave_idempotencia, referencia, actor_usuario_id,
    anulado_por_usuario_id, motivo_anulacion, anulado_en,
    created_at, updated_at, deleted_at
  )
  SELECT
    id, turno_id, NULL, monto_centavos, moneda, medio, estado,
    NULL, NULL, NULL,
    NULL, NULL, NULL,
    created_at, updated_at, deleted_at
  FROM pago;
DROP TABLE pago;
ALTER TABLE pago_nuevo_010 RENAME TO pago;
CREATE INDEX IF NOT EXISTS idx_pago_turno ON pago(turno_id);
CREATE INDEX IF NOT EXISTS idx_pago_presupuesto ON pago(presupuesto_id);
CREATE INDEX IF NOT EXISTS idx_pago_estado ON pago(estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pago_clave_idempotencia
  ON pago(clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS movimiento_caja (
  id TEXT PRIMARY KEY,
  pago_id TEXT NOT NULL REFERENCES pago(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('cobro', 'anulacion')),
  monto_centavos INTEGER NOT NULL
    CHECK (monto_centavos >= 0)
    CHECK (monto_centavos = CAST(monto_centavos AS INTEGER)),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  fecha_contable TEXT NOT NULL
    CHECK (fecha_contable GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  aplicado_en TEXT NOT NULL
    CHECK (aplicado_en GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  motivo_asignacion TEXT
    CHECK (motivo_asignacion IS NULL OR motivo_asignacion = 'fecha_ya_cerrada'),
  created_at TEXT NOT NULL,
  CHECK (
    (IFNULL(motivo_asignacion, '') = '' AND aplicado_en = fecha_contable)
    OR (IFNULL(motivo_asignacion, '') = 'fecha_ya_cerrada' AND aplicado_en <> fecha_contable)
  )
);
CREATE INDEX IF NOT EXISTS idx_mov_caja_aplicado_en
  ON movimiento_caja(aplicado_en);
CREATE INDEX IF NOT EXISTS idx_mov_caja_fecha_contable
  ON movimiento_caja(fecha_contable);
CREATE INDEX IF NOT EXISTS idx_mov_caja_pago ON movimiento_caja(pago_id);
CREATE TRIGGER movimiento_caja_no_update BEFORE UPDATE ON movimiento_caja
BEGIN SELECT RAISE(ABORT, 'movimiento_caja es insert-only'); END;
CREATE TRIGGER movimiento_caja_no_delete BEFORE DELETE ON movimiento_caja
BEGIN SELECT RAISE(ABORT, 'movimiento_caja es insert-only'); END;

CREATE TABLE IF NOT EXISTS cierre_caja (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL UNIQUE
    CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  zona_horaria TEXT NOT NULL CHECK (length(zona_horaria) > 0),
  total_efectivo_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (total_efectivo_centavos >= 0)
    CHECK (total_efectivo_centavos = CAST(total_efectivo_centavos AS INTEGER)),
  total_tarjeta_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (total_tarjeta_centavos >= 0)
    CHECK (total_tarjeta_centavos = CAST(total_tarjeta_centavos AS INTEGER)),
  total_transferencia_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (total_transferencia_centavos >= 0)
    CHECK (total_transferencia_centavos = CAST(total_transferencia_centavos AS INTEGER)),
  total_mercadopago_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (total_mercadopago_centavos >= 0)
    CHECK (total_mercadopago_centavos = CAST(total_mercadopago_centavos AS INTEGER)),
  total_obra_social_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (total_obra_social_centavos >= 0)
    CHECK (total_obra_social_centavos = CAST(total_obra_social_centavos AS INTEGER)),
  anulaciones_cantidad INTEGER NOT NULL DEFAULT 0
    CHECK (anulaciones_cantidad >= 0)
    CHECK (anulaciones_cantidad = CAST(anulaciones_cantidad AS INTEGER)),
  anulaciones_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (anulaciones_centavos >= 0)
    CHECK (anulaciones_centavos = CAST(anulaciones_centavos AS INTEGER)),
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  cerrado_en TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER cierre_caja_no_update BEFORE UPDATE ON cierre_caja
BEGIN SELECT RAISE(ABORT, 'cierre_caja es insert-only'); END;
CREATE TRIGGER cierre_caja_no_delete BEFORE DELETE ON cierre_caja
BEGIN SELECT RAISE(ABORT, 'cierre_caja es insert-only'); END;
`;

/** 008 — historia clínica, odontograma, delegaciones y auditoría PHI (C-09). */
export const MIGRATION_008_CLINICA = `
ALTER TABLE paciente ADD COLUMN fecha_nacimiento TEXT;
ALTER TABLE paciente ADD COLUMN alergias TEXT;
ALTER TABLE usuario ADD COLUMN profesional_id TEXT REFERENCES profesional(id);
CREATE UNIQUE INDEX idx_usuario_profesional
  ON usuario(profesional_id) WHERE profesional_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hc_evento (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  turno_id TEXT REFERENCES turno(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('consulta','nota','diagnostico','procedimiento')),
  detalle TEXT NOT NULL CHECK (length(detalle) BETWEEN 1 AND 5000),
  ocurrido_en TEXT NOT NULL,
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  enmienda_de TEXT REFERENCES hc_evento(id),
  motivo_enmienda TEXT,
  created_at TEXT NOT NULL,
  CHECK ((enmienda_de IS NULL AND motivo_enmienda IS NULL)
      OR (enmienda_de IS NOT NULL AND length(trim(motivo_enmienda)) > 0)),
  CHECK (enmienda_de IS NULL OR enmienda_de <> id)
);
CREATE UNIQUE INDEX idx_hc_evento_enmienda
  ON hc_evento(enmienda_de) WHERE enmienda_de IS NOT NULL;
CREATE INDEX idx_hc_evento_paciente ON hc_evento(paciente_id, ocurrido_en, id);
CREATE INDEX idx_hc_evento_turno ON hc_evento(turno_id);

CREATE TABLE IF NOT EXISTS odontograma_evento (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  turno_id TEXT REFERENCES turno(id),
  pieza_fdi INTEGER NOT NULL CHECK (
    pieza_fdi % 10 BETWEEN 1 AND 8
    AND (pieza_fdi BETWEEN 11 AND 48 OR pieza_fdi BETWEEN 51 AND 85)
  ),
  superficie TEXT NOT NULL CHECK (superficie IN ('M','D','V','L','O','I')),
  hallazgo TEXT NOT NULL CHECK (hallazgo IN (
    'sano','caries','obturado','ausente','corona','endodoncia',
    'implante','extraccion_indicada','sellante','fractura'
  )),
  ocurrido_en TEXT NOT NULL,
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  enmienda_de TEXT REFERENCES odontograma_evento(id),
  motivo_enmienda TEXT,
  created_at TEXT NOT NULL,
  CHECK ((enmienda_de IS NULL AND motivo_enmienda IS NULL)
      OR (enmienda_de IS NOT NULL AND length(trim(motivo_enmienda)) > 0)),
  CHECK (enmienda_de IS NULL OR enmienda_de <> id)
);
CREATE UNIQUE INDEX idx_odontograma_evento_enmienda
  ON odontograma_evento(enmienda_de) WHERE enmienda_de IS NOT NULL;
CREATE INDEX idx_odontograma_paciente
  ON odontograma_evento(paciente_id, pieza_fdi, superficie, ocurrido_en, id);

CREATE TABLE IF NOT EXISTS delegacion_hc (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  otorgada_por_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) > 0),
  revocada_en TEXT,
  created_at TEXT NOT NULL,
  CHECK (hasta > desde)
);
CREATE INDEX idx_delegacion_hc_lookup
  ON delegacion_hc(paciente_id, profesional_id, hasta);

CREATE TABLE IF NOT EXISTS auditoria_phi (
  id TEXT PRIMARY KEY,
  ocurrido_en TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuario(id),
  rol TEXT NOT NULL CHECK (rol IN ('recepcion','profesional','administracion')),
  paciente_id TEXT,
  recurso TEXT NOT NULL CHECK (recurso IN (
    'historia_clinica','odontograma','delegacion_hc','paciente'
  )),
  recurso_id TEXT,
  accion TEXT NOT NULL CHECK (accion IN ('leer','crear','editar','exportar','imprimir')),
  resultado TEXT NOT NULL CHECK (resultado IN ('permitido','denegado')),
  motivo TEXT CHECK (motivo IS NULL OR motivo IN (
    'sin_vinculo','rol_no_autorizado','delegacion_vencida'
  )),
  ip TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auditoria_phi_paciente ON auditoria_phi(paciente_id, ocurrido_en);
CREATE INDEX idx_auditoria_phi_usuario ON auditoria_phi(usuario_id, ocurrido_en);

CREATE TRIGGER hc_evento_no_update BEFORE UPDATE ON hc_evento
BEGIN SELECT RAISE(ABORT, 'hc_evento es insert-only'); END;
CREATE TRIGGER hc_evento_no_delete BEFORE DELETE ON hc_evento
BEGIN SELECT RAISE(ABORT, 'hc_evento es insert-only'); END;
CREATE TRIGGER odontograma_evento_no_update BEFORE UPDATE ON odontograma_evento
BEGIN SELECT RAISE(ABORT, 'odontograma_evento es insert-only'); END;
CREATE TRIGGER odontograma_evento_no_delete BEFORE DELETE ON odontograma_evento
BEGIN SELECT RAISE(ABORT, 'odontograma_evento es insert-only'); END;
CREATE TRIGGER auditoria_phi_no_update BEFORE UPDATE ON auditoria_phi
BEGIN SELECT RAISE(ABORT, 'auditoria_phi es insert-only'); END;
CREATE TRIGGER auditoria_phi_no_delete BEFORE DELETE ON auditoria_phi
BEGIN SELECT RAISE(ABORT, 'auditoria_phi es insert-only'); END;
`;

/** Una migración versionada: id ascendente + SQL idempotente (`IF NOT EXISTS`). */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/**
 * 011 — obras sociales (C-12): cobertura por turno (cargo RN-07), liquidación de
 * reintegros (cabecera + ítems) e historial append-only de eventos.
 * FKs únicamente a core 001–004 (todas `id TEXT` [comprobado en 001–009]);
 * sin FK a presupuesto (C-10) ni a pago (C-11): cambios independientes (design D1/D2).
 * Montos/balance invariante via CHECKs; unicidades lógicas parciales
 * `WHERE deleted_at IS NULL` (design D6); triggers insert-only al estilo C-09.
 */
export const MIGRATION_011_OBRAS_SOCIALES = `
CREATE TABLE IF NOT EXISTS obra_social_cobertura_turno (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  prestacion_id TEXT NOT NULL REFERENCES prestacion(id),
  obra_social_plan_id TEXT NOT NULL REFERENCES obra_social_plan(id),
  monto_total_centavos INTEGER NOT NULL
    CHECK (monto_total_centavos >= 0)
    CHECK (monto_total_centavos = CAST(monto_total_centavos AS INTEGER)),
  cobertura_pct INTEGER NOT NULL
    CHECK (cobertura_pct BETWEEN 0 AND 100)
    CHECK (cobertura_pct = CAST(cobertura_pct AS INTEGER)),
  cobertura_centavos INTEGER NOT NULL
    CHECK (cobertura_centavos >= 0)
    CHECK (cobertura_centavos = CAST(cobertura_centavos AS INTEGER)),
  saldo_paciente_centavos INTEGER NOT NULL
    CHECK (saldo_paciente_centavos >= 0)
    CHECK (saldo_paciente_centavos = CAST(saldo_paciente_centavos AS INTEGER)),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (cobertura_centavos <= monto_total_centavos),
  CHECK (saldo_paciente_centavos = monto_total_centavos - cobertura_centavos)
);
CREATE UNIQUE INDEX IF NOT EXISTS os_cobertura_turno_unica
  ON obra_social_cobertura_turno(turno_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_cobertura_plan_fecha
  ON obra_social_cobertura_turno(obra_social_plan_id, created_at);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion (
  id TEXT PRIMARY KEY,
  obra_social_plan_id TEXT NOT NULL REFERENCES obra_social_plan(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL CHECK (hasta >= desde),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'presentada', 'pagada')), -- Decisión Q2 aprobada
  monto_total_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (monto_total_centavos >= 0)
    CHECK (monto_total_centavos = CAST(monto_total_centavos AS INTEGER)),
  generada_por_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS os_liquidacion_plan_periodo_unica
  ON obra_social_liquidacion(obra_social_plan_id, desde, hasta) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_liquidacion_estado ON obra_social_liquidacion(estado);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion_item (
  id TEXT PRIMARY KEY,
  liquidacion_id TEXT NOT NULL REFERENCES obra_social_liquidacion(id),
  cobertura_id TEXT NOT NULL REFERENCES obra_social_cobertura_turno(id),
  turno_id TEXT NOT NULL REFERENCES turno(id),
  monto_cobertura_centavos INTEGER NOT NULL
    CHECK (monto_cobertura_centavos >= 0)
    CHECK (monto_cobertura_centavos = CAST(monto_cobertura_centavos AS INTEGER)),
  saldo_paciente_centavos INTEGER NOT NULL
    CHECK (saldo_paciente_centavos >= 0),
  cobertura_pct INTEGER NOT NULL
    CHECK (cobertura_pct BETWEEN 0 AND 100)
    CHECK (cobertura_pct = CAST(cobertura_pct AS INTEGER)),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS os_item_turno_liquidado_unico
  ON obra_social_liquidacion_item(turno_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_item_liquidacion
  ON obra_social_liquidacion_item(liquidacion_id);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion_evento (
  id TEXT PRIMARY KEY,
  liquidacion_id TEXT NOT NULL REFERENCES obra_social_liquidacion(id),
  evento TEXT NOT NULL CHECK (evento IN ('generada', 'presentada', 'pagada')),
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  ocurrido_en TEXT NOT NULL, -- momento del evento de negocio
  created_at TEXT NOT NULL  -- sello de inserción (contrato de AppendOnlyRepository)
);
CREATE INDEX IF NOT EXISTS os_evento_liquidacion
  ON obra_social_liquidacion_evento(liquidacion_id, ocurrido_en);
CREATE TRIGGER os_evento_no_update BEFORE UPDATE ON obra_social_liquidacion_evento
BEGIN SELECT RAISE(ABORT, 'obra_social_liquidacion_evento es insert-only'); END;
CREATE TRIGGER os_evento_no_delete BEFORE DELETE ON obra_social_liquidacion_evento
BEGIN SELECT RAISE(ABORT, 'obra_social_liquidacion_evento es insert-only'); END;
`;

/**
 * Registro ordenado de migraciones (design D4). La migración base 001 crea las
 * tablas núcleo. El orden del array ES el orden de aplicación.
 */
export const MIGRATIONS: readonly Migration[] = [
  { id: '001', sql: MIGRATION_001_CORE },
  { id: '002', sql: MIGRATION_002_AUTH },
  { id: '003', sql: MIGRATION_003_TURNO_BLOQUEO },
  { id: '004', sql: MIGRATION_004_CORE_COMPLETE },
  { id: '005', sql: MIGRATION_005_AUTH_TOKENS },
  { id: '006', sql: MIGRATION_006_TURNO_TOKEN },
  { id: '007', sql: MIGRATION_007_RECORDATORIO },
  { id: '008', sql: MIGRATION_008_CLINICA },
  { id: '009', sql: MIGRATION_009_PRESUPUESTOS },
  { id: '010', sql: MIGRATION_010_CAJA },
  { id: '011', sql: MIGRATION_011_OBRAS_SOCIALES },
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

