/**
 * Task 2.2: Migración 011 - tablas de obras sociales y liquidación.
 * SQLite REAL en memoria (R12: sin mock de base ni de transacciones).
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

function sembrarEntidadesBase(db: DatabaseSync): void {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sil-1', 'Sillón Ficticio', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at) VALUES ('prof-1', 'Prof Ficticio', 'M-123', 'Odontología', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at) VALUES ('usr-1', 'admin@example.test', 'hash', 1, null, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES ('osp-1', 'OSDE', '210', 80, 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', '+54 9 11 0000-0000', 'osp-1', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at) VALUES ('pres-1', 'CONS-01', 'Consulta', 30, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('tur-1', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('tur-2', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(ahora, ahora);
}

describe('Migración 011 - obras sociales y liquidaciones', () => {
  it('Dado MIGRATIONS Cuando lista migraciones Entonces incluye 011 y 012 al final', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain('011');
    expect(ids[ids.length - 1]).toBe('014');
  });

  it('Dado BD nueva Cuando corre runMigrations Entonces crea las 4 tablas de C-12', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const tables = (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'obra_social_%'`,
          )
          .all() as { name: string }[]
      ).map((r) => r.name);

      expect(tables).toContain('obra_social_cobertura_turno');
      expect(tables).toContain('obra_social_liquidacion');
      expect(tables).toContain('obra_social_liquidacion_item');
      expect(tables).toContain('obra_social_liquidacion_evento');
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_cobertura_turno Cuando se inspeccionan columnas Entonces no contiene campos espurios', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const cols = columnasTabla(db, 'obra_social_cobertura_turno');
      expect(cols).toEqual([
        'id',
        'turno_id',
        'prestacion_id',
        'obra_social_plan_id',
        'monto_total_centavos',
        'cobertura_pct',
        'cobertura_centavos',
        'saldo_paciente_centavos',
        'moneda',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_liquidacion_evento Cuando se inspeccionan columnas Entonces NO contiene detalle', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const cols = columnasTabla(db, 'obra_social_liquidacion_evento');
      expect(cols).toEqual([
        'id',
        'liquidacion_id',
        'evento',
        'actor_usuario_id',
        'ocurrido_en',
        'created_at',
      ]);
      expect(cols).not.toContain('detalle');
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_cobertura_turno Cuando balance no cuadra Entonces CHECK rechaza', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      sembrarEntidadesBase(db);
      const ahora = new Date().toISOString();

      // Saldo no cuadra (total 10000, cobertura 8000, saldo puesto en 1000 en vez de 2000)
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_cobertura_turno (
              id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
              cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at
            ) VALUES ('cob-1', 'tur-1', 'pres-1', 'osp-1', 10000, 80, 8000, 1000, 'ARS', ?, ?)`,
          )
          .run(ahora, ahora),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_cobertura_turno Cuando cobertura_pct es fuera de rango Entonces CHECK rechaza', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      sembrarEntidadesBase(db);
      const ahora = new Date().toISOString();

      // pct > 100
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_cobertura_turno (
              id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
              cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at
            ) VALUES ('cob-1', 'tur-1', 'pres-1', 'osp-1', 10000, 120, 10000, 0, 'ARS', ?, ?)`,
          )
          .run(ahora, ahora),
      ).toThrow();

      // pct < 0
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_cobertura_turno (
              id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
              cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at
            ) VALUES ('cob-1', 'tur-1', 'pres-1', 'osp-1', 10000, -5, 0, 10000, 'ARS', ?, ?)`,
          )
          .run(ahora, ahora),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_liquidacion Cuando hasta < desde Entonces CHECK rechaza', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      sembrarEntidadesBase(db);
      const ahora = new Date().toISOString();

      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_liquidacion (
              id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at
            ) VALUES ('liq-1', 'osp-1', '2026-11-10T00:00:00.000Z', '2026-11-05T00:00:00.000Z', 'borrador', 0, 'usr-1', ?, ?)`,
          )
          .run(ahora, ahora),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('Dado UNIQUE parciales Cuando se inserta duplicado activo rechaza, pero si está dado de baja permite', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      sembrarEntidadesBase(db);
      const ahora = new Date().toISOString();

      // Cobertura 1 para tur-1
      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (
          id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
          cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at, deleted_at
        ) VALUES ('cob-1', 'tur-1', 'pres-1', 'osp-1', 10000, 80, 8000, 2000, 'ARS', ?, ?, null)`,
      ).run(ahora, ahora);

      // Duplicado sobre tur-1 con deleted_at NULL -> debe fallar por índice único parcial
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_cobertura_turno (
              id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
              cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at, deleted_at
            ) VALUES ('cob-2', 'tur-1', 'pres-1', 'osp-1', 10000, 80, 8000, 2000, 'ARS', ?, ?, null)`,
          )
          .run(ahora, ahora),
      ).toThrow();

      // Damos de baja la cobertura cob-1
      db.prepare(
        `UPDATE obra_social_cobertura_turno SET deleted_at = ? WHERE id = 'cob-1'`,
      ).run(ahora);

      // Ahora tur-1 puede tener una nueva cobertura activa
      db.prepare(
        `INSERT INTO obra_social_cobertura_turno (
          id, turno_id, prestacion_id, obra_social_plan_id, monto_total_centavos,
          cobertura_pct, cobertura_centavos, saldo_paciente_centavos, moneda, created_at, updated_at, deleted_at
        ) VALUES ('cob-2', 'tur-1', 'pres-1', 'osp-1', 10000, 80, 8000, 2000, 'ARS', ?, ?, null)`,
      ).run(ahora, ahora);

      expect(
        db
          .prepare(
            `SELECT COUNT(*) as count FROM obra_social_cobertura_turno WHERE turno_id = 'tur-1'`,
          )
          .get(),
      ).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  it('Dado obra_social_liquidacion_evento Cuando se intenta UPDATE o DELETE Entonces los triggers abortan', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      sembrarEntidadesBase(db);
      const ahora = new Date().toISOString();

      db.prepare(
        `INSERT INTO obra_social_liquidacion (
          id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at
        ) VALUES ('liq-1', 'osp-1', '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z', 'borrador', 0, 'usr-1', ?, ?)`,
      ).run(ahora, ahora);

      db.prepare(
        `INSERT INTO obra_social_liquidacion_evento (
          id, liquidacion_id, evento, actor_usuario_id, ocurrido_en, created_at
        ) VALUES ('evt-1', 'liq-1', 'generada', 'usr-1', ?, ?)`,
      ).run(ahora, ahora);

      // Intento de UPDATE -> Trigger os_evento_no_update
      expect(() =>
        db
          .prepare(
            `UPDATE obra_social_liquidacion_evento SET evento = 'presentada' WHERE id = 'evt-1'`,
          )
          .run(),
      ).toThrow(/obra_social_liquidacion_evento es insert-only/);

      // Intento de DELETE -> Trigger os_evento_no_delete
      expect(() =>
        db
          .prepare(
            `DELETE FROM obra_social_liquidacion_evento WHERE id = 'evt-1'`,
          )
          .run(),
      ).toThrow(/obra_social_liquidacion_evento es insert-only/);
    } finally {
      db.close();
    }
  });
});
