/**
 * Task 1.1: Migración 010 - caja (C-11).
 * SQLite REAL en memoria (R12: sin mock de base ni de transacciones), datos
 * estrictamente ficticios (R1/R12). Verifica: esquema tras 010, FKs activas,
 * preservación de filas/columnas de `pago` previas al rebuild, CHECK de
 * aplicación obligatoria, idempotencia del runner, UNIQUE parcial de
 * `clave_idempotencia`, CHECK de coherencia de `movimiento_caja` y triggers
 * insert-only.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  applyMigration,
  runMigrations,
} from '../src/shared/migrations.js';
import { openDatabase } from '../src/shared/repository.js';

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

function triggersDe(db: DatabaseSync, tabla: string): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ?`,
      )
      .all(tabla) as unknown as { name: string }[]
  ).map((t) => t.name);
}

/** Base en estado pre-010 (001→009 aplicadas a mano) con entidades base. */
function crearBasePre010(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const migration of MIGRATIONS) {
    if (migration.id < '010') {
      db.exec(migration.sql);
    }
  }
  const ahora = '2026-05-30T12:00:00.000Z';
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-leg', 'Profesional Legado', 'MN-2001', 'Odontología', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-leg', 'Sillón Legado', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-leg', 'LEG-01', 'Prestación Legado', 30, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, created_at, updated_at)
     VALUES ('pac-leg', 'Paciente Legado Ficticio', NULL, NULL, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at)
     VALUES ('user-leg', 'legado@ficticio.test', 'hash', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES ('turno-leg', 'prof-leg', 'sillon-leg', 'pac-leg', 'pres-leg',
             '2026-05-30T13:00:00.000Z', '2026-05-30T13:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(ahora, ahora);
  return db;
}

function sembrarPagoLegado(db: DatabaseSync, id: string, monto: number, medio: string, estado: string): void {
  db.prepare(
    `INSERT INTO pago (id, turno_id, monto_centavos, moneda, medio, estado, created_at, updated_at, deleted_at)
     VALUES (?, 'turno-leg', ?, 'ARS', ?, ?, '2026-05-30T14:00:00.000Z', '2026-05-30T14:00:00.000Z', NULL)`,
  ).run(id, monto, medio, estado);
}

describe('Migración 010 - caja (C-11)', () => {
  it('Dado el runner completo Cuando inspecciono el esquema Entonces 010 crea pago recompuesto, movimiento_caja y cierre_caja con sus columnas, FKs y triggers', () => {
    const db = openDatabase(':memory:');

    expect(columnasTabla(db, 'pago')).toEqual([
      'id', 'turno_id', 'presupuesto_id', 'monto_centavos', 'moneda',
      'medio', 'estado', 'clave_idempotencia', 'referencia',
      'actor_usuario_id', 'anulado_por_usuario_id', 'motivo_anulacion',
      'anulado_en', 'created_at', 'updated_at', 'deleted_at',
    ]);
    expect(columnasTabla(db, 'movimiento_caja')).toEqual([
      'id', 'pago_id', 'tipo', 'monto_centavos', 'moneda',
      'actor_usuario_id', 'fecha_contable', 'aplicado_en',
      'motivo_asignacion', 'created_at',
    ]);
    expect(columnasTabla(db, 'cierre_caja')).toEqual([
      'id', 'fecha', 'zona_horaria', 'total_efectivo_centavos',
      'total_tarjeta_centavos', 'total_transferencia_centavos',
      'total_mercadopago_centavos', 'total_obra_social_centavos',
      'anulaciones_cantidad', 'anulaciones_centavos',
      'actor_usuario_id', 'cerrado_en', 'created_at', 'updated_at',
    ]);

    const fksPago = fksTabla(db, 'pago');
    expect(fksPago).toContain('turno');
    expect(fksPago).toContain('presupuesto');
    expect(fksPago).toContain('usuario');

    const fksMov = fksTabla(db, 'movimiento_caja');
    expect(fksMov).toContain('pago');
    expect(fksMov).toContain('usuario');

    expect(
      [...triggersDe(db, 'movimiento_caja')].sort(),
    ).toEqual(
      ['movimiento_caja_no_delete', 'movimiento_caja_no_update'],
    );
    expect([...triggersDe(db, 'cierre_caja')].sort()).toEqual(
      ['cierre_caja_no_delete', 'cierre_caja_no_update'],
    );

    db.close();
  });

  it('Dado pagos previos de migraciones anteriores Cuando aplica 010 Entonces conserva id, turno_id, montos, medios, estados y auditoría (presupuesto_id NULL)', () => {
    const db = crearBasePre010();
    sembrarPagoLegado(db, 'pago-leg-1', 250000, 'efectivo', 'cobrado');
    sembrarPagoLegado(db, 'pago-leg-2', 100000, 'tarjeta', 'pendiente');

    applyMigration(db, '010');

    const filas = db
      .prepare(
        `SELECT id, turno_id, presupuesto_id, monto_centavos, medio, estado,
                clave_idempotencia, actor_usuario_id, motivo_anulacion,
                anulado_en, created_at, deleted_at
           FROM pago ORDER BY id`,
      )
      .all() as unknown as {
      id: string;
      turno_id: string;
      presupuesto_id: number | null;
      monto_centavos: number;
      medio: string;
      estado: string;
      clave_idempotencia: string | null;
      actor_usuario_id: string | null;
      motivo_anulacion: string | null;
      anulado_en: string | null;
      created_at: string;
      deleted_at: string | null;
    }[];

    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      id: 'pago-leg-1',
      turno_id: 'turno-leg',
      presupuesto_id: null,
      monto_centavos: 250000,
      medio: 'efectivo',
      estado: 'cobrado',
      clave_idempotencia: null,
      motivo_anulacion: null,
      anulado_en: null,
      created_at: '2026-05-30T14:00:00.000Z',
      deleted_at: null,
    });
    expect(filas[1]).toMatchObject({
      id: 'pago-leg-2',
      monto_centavos: 100000,
      medio: 'tarjeta',
      estado: 'pendiente',
    });

    db.close();
  });

  it('Dado el CHECK de aplicación obligatoria Cuando inserto pago sin turno y sin presupuesto Entonces lo rechaza', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    expect(() =>
      db
        .prepare(
          `INSERT INTO pago (id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado, created_at, updated_at)
           VALUES ('pago-huerfano', NULL, NULL, 5000, 'ARS', 'efectivo', 'cobrado', 'x', 'x')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });

  it('Dado FKs activas Cuando inserto pago con turno inexistente Entonces lo rechaza', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    expect(() =>
      db
        .prepare(
          `INSERT INTO pago (id, turno_id, monto_centavos, moneda, medio, estado, created_at, updated_at)
           VALUES ('pago-rotto', 'turno-inexistente', 5000, 'ARS', 'efectivo', 'cobrado', 'x', 'x')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });

  it('Dado dos pagos con la misma clave de idempotencia Cuando inserto el segundo Entonces el UNIQUE parcial lo rechaza', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    const insert = (id: string): void => {
      db.prepare(
        `INSERT INTO pago (id, turno_id, monto_centavos, moneda, medio, estado, clave_idempotencia, created_at, updated_at)
         VALUES (?, 'turno-leg', 7000, 'ARS', 'efectivo', 'cobrado', 'clave-unica-1', 'x', 'x')`,
      ).run(id);
    };
    insert('pago-clave-a');
    expect(() => insert('pago-clave-b')).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  it('Dado el CHECK de coherencia de movimiento_caja Cuando aplicado_en difiere sin motivo Entonces rechaza; con motivo fecha_ya_cerrada y fecha distinta acepta', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    sembrarPagoLegado(db, 'pago-mov', 900000, 'tarjeta', 'cobrado');

    const insertar = (fecha: string, aplicado: string, motivo: string | null): void => {
      db.prepare(
        `INSERT INTO movimiento_caja
           (id, pago_id, tipo, monto_centavos, moneda, actor_usuario_id, fecha_contable, aplicado_en, motivo_asignacion, created_at)
         VALUES (?, 'pago-mov', 'cobro', 900000, 'ARS', 'user-leg', ?, ?, ?, '2026-06-01T12:00:00.000Z')`,
      ).run(`mov-${fecha}-${aplicado}-${String(motivo)}`, fecha, aplicado, motivo);
    };

    // mismatch sin motivo → rechazado
    expect(() => insertar('2026-06-01', '2026-06-02', null)).toThrow(/CHECK constraint failed/);
    // mismo día con motivo → rechazado
    expect(() => insertar('2026-06-01', '2026-06-01', 'fecha_ya_cerrada')).toThrow(/CHECK constraint failed/);
    // día distinto con motivo → válido
    insertar('2026-06-01', '2026-06-02', 'fecha_ya_cerrada');
    const n = db.prepare('SELECT COUNT(*) AS n FROM movimiento_caja').get() as { n: number };
    expect(n.n).toBe(1);
    db.close();
  });

  it('Dado triggers insert-only Cuando ejecuto UPDATE o DELETE directos en movimiento_caja Entonces SQLite aborta', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    sembrarPagoLegado(db, 'pago-trig', 15000, 'efectivo', 'cobrado');
    db.prepare(
      `INSERT INTO movimiento_caja
         (id, pago_id, tipo, monto_centavos, moneda, actor_usuario_id, fecha_contable, aplicado_en, motivo_asignacion, created_at)
       VALUES ('mov-trig', 'pago-trig', 'cobro', 15000, 'ARS', 'user-leg', '2026-06-01', '2026-06-01', NULL, '2026-06-01T12:00:00.000Z')`,
    ).run();
    expect(() => db.prepare(`UPDATE movimiento_caja SET monto_centavos = 0 WHERE id = 'mov-trig'`).run())
      .toThrow(/movimiento_caja es insert-only/);
    expect(() => db.prepare(`DELETE FROM movimiento_caja WHERE id = 'mov-trig'`).run())
      .toThrow(/movimiento_caja es insert-only/);
    db.close();
  });

  it('Dado cierre_caja UNIQUE(fecha) Cuando inserto un segundo cierre del mismo día Entonces lo rechaza', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    const insertar = (): void => {
      db.prepare(
        `INSERT INTO cierre_caja
           (id, fecha, zona_horaria, total_efectivo_centavos, total_tarjeta_centavos,
            total_transferencia_centavos, total_mercadopago_centavos, total_obra_social_centavos,
            anulaciones_cantidad, anulaciones_centavos, actor_usuario_id, cerrado_en, created_at, updated_at)
         VALUES ('cierre-x', '2026-06-30', 'America/Buenos_Aires', 0, 0, 0, 0, 0, 0, 0, 'user-leg', 'x', 'x', 'x')`,
      ).run();
    };
    insertar();
    expect(() => insertar()).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  it('Dado una fecha contable con formato invalid Entonces el CHECK GLOB la rechaza', () => {
    const db = crearBasePre010();
    applyMigration(db, '010');
    expect(() =>
      db
        .prepare(
          `INSERT INTO cierre_caja
             (id, fecha, zona_horaria, total_efectivo_centavos, total_tarjeta_centavos,
              total_transferencia_centavos, total_mercadopago_centavos, total_obra_social_centavos,
              anulaciones_cantidad, anulaciones_centavos, actor_usuario_id, cerrado_en, created_at, updated_at)
           VALUES ('cierre-bad', '30-06-2026', 'America/Buenos_Aires', 0, 0, 0, 0, 0, 0, 0, 'user-leg', 'x', 'x', 'x')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });

  it('Dado el runner corre dos veces Cuando re-ejecuto runMigrations Entonces es idempotente (010 una sola vez, sin error ni duplicados)', () => {
    const db = openDatabase(':memory:');
    const primera = runMigrations(db);
    expect(primera).toEqual([]);
    const pagos = db.prepare('SELECT COUNT(*) AS n FROM pago').get() as { n: number };
    const idsAplicados = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as unknown as { id: string }[];
    expect(idsAplicados.map((r) => r.id)).toEqual([
      '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017',
    ]);
    expect(pagos.n).toBe(0);
    db.close();
  });
});
