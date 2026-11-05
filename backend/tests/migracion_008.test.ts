/**
 * C-09 task 2.1: Migración 008 - esquema clínico.
 * Verifica columnas nuevas en paciente/usuario, tablas clínicas, índices y
 * UNIQUE parcial de enmienda_de. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_008_CLINICA, MIGRATIONS } from '../src/shared/migrations.js';

function columnas(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  ).map((c) => c.name);
}

function indices(db: DatabaseSync): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as {
      name: string;
    }[]
  ).map((i) => i.name);
}

function tablas(db: DatabaseSync): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((t) => t.name);
}

function crearDbCon008(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const baseSql = MIGRATIONS
    .filter((m) => m.id !== '008')
    .map((m) => m.sql)
    .join('\n');
  db.exec(baseSql);
  db.exec(MIGRATION_008_CLINICA);
  return db;
}

function insertarPacienteYProfesional(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-1', 'Sillón Ficticio', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Prof Ficticio', 'MAT-1', 'Odonto Ficticia', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
     VALUES ('user-1', 'prof@example.test', 'hash', 1, 'prof-1', ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at, deleted_at)
     VALUES ('pac-1', 'Paciente Ficticio', '+54 9 11 0000-0000', null, 1, ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
}

describe('MIGRATION_008_CLINICA', () => {
  it('Dado migración 008 Cuando se aplica Entonces existen tablas clínicas y columnas nuevas', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const baseSql = MIGRATIONS
        .filter((m) => m.id !== '008')
        .map((m) => m.sql)
        .join('\n');
      db.exec(baseSql);
      db.exec(MIGRATION_008_CLINICA);

      const colsPaciente = columnas(db, 'paciente');
      expect(colsPaciente).toContain('fecha_nacimiento');
      expect(colsPaciente).toContain('alergias');

      const colsUsuario = columnas(db, 'usuario');
      expect(colsUsuario).toContain('profesional_id');

      const ts = tablas(db);
      expect(ts).toContain('hc_evento');
      expect(ts).toContain('odontograma_evento');
      expect(ts).toContain('delegacion_hc');
      expect(ts).toContain('auditoria_phi');

      const idx = indices(db);
      expect(idx).toContain('idx_usuario_profesional');
      expect(idx).toContain('idx_hc_evento_enmienda');
      expect(idx).toContain('idx_odontograma_evento_enmienda');
      expect(idx).toContain('idx_hc_evento_paciente');
      expect(idx).toContain('idx_odontograma_paciente');
      expect(idx).toContain('idx_delegacion_hc_lookup');
      expect(idx).toContain('idx_auditoria_phi_paciente');
      expect(idx).toContain('idx_auditoria_phi_usuario');
    } finally {
      db.close();
    }
  });

  it('Dado MIGRATIONS Cuando inspecciono Entonces 008 está registrada al final', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toEqual([
      '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011',
    ]);
  });
});

describe('CHECK constraints de migración 008', () => {
  it('Dado pieza FDI inválida (19, 49, 00, 86) Cuando se inserta en odontograma_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    for (const pieza of [19, 49, 0, 86]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO odontograma_evento (id, paciente_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at)
             VALUES ('evt-${pieza}', 'pac-1', ${pieza}, 'M', 'sano', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
          )
          .run(),
      ).toThrow();
    }
    db.close();
  });

  it('Dado pieza FDI válida Cuando se inserta en odontograma_evento Entonces SQLite acepta', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    for (const pieza of [11, 16, 48, 51, 55, 85]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO odontograma_evento (id, paciente_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at)
             VALUES ('evt-${pieza}', 'pac-1', ${pieza}, 'M', 'sano', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
          )
          .run(),
      ).not.toThrow();
    }
    db.close();
  });

  it('Dado superficie inválida Cuando se inserta en odontograma_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO odontograma_evento (id, paciente_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at)
           VALUES ('evt-bad-surf', 'pac-1', 16, 'X', 'sano', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado hallazgo fuera de catálogo Cuando se inserta en odontograma_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO odontograma_evento (id, paciente_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at)
           VALUES ('evt-bad-hall', 'pac-1', 16, 'O', 'mancha', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado detalle vacío Cuando se inserta en hc_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO hc_evento (id, paciente_id, tipo, detalle, ocurrido_en, actor_usuario_id, profesional_id, created_at)
           VALUES ('evt-empty', 'pac-1', 'consulta', '', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado detalle de 5001 caracteres Cuando se inserta en hc_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    const detalleLargo = 'x'.repeat(5001);
    expect(() =>
      db
        .prepare(
          `INSERT INTO hc_evento (id, paciente_id, tipo, detalle, ocurrido_en, actor_usuario_id, profesional_id, created_at)
           VALUES ('evt-long', 'pac-1', 'consulta', ?, '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
        )
        .run(detalleLargo),
    ).toThrow();
    db.close();
  });

  it('Dado enmienda sin motivo Cuando se inserta en hc_evento Entonces SQLite rechaza', () => {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO hc_evento (id, paciente_id, tipo, detalle, ocurrido_en, actor_usuario_id, profesional_id, enmienda_de, motivo_enmienda, created_at)
           VALUES ('evt-enm', 'pac-1', 'consulta', 'detalle', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', 'evt-orig', NULL, '2026-11-01T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});

describe('Triggers insert-only y FK/UNIQUE de migración 008', () => {
  function crearDbCon008YDatos(): DatabaseSync {
    const db = crearDbCon008();
    insertarPacienteYProfesional(db);
    db.prepare(
      `INSERT INTO hc_evento (id, paciente_id, tipo, detalle, ocurrido_en, actor_usuario_id, profesional_id, created_at)
       VALUES ('evt-1', 'pac-1', 'consulta', 'detalle ficticio', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO odontograma_evento (id, paciente_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at)
       VALUES ('oe-1', 'pac-1', 16, 'O', 'caries', '2026-11-01T10:00:00.000Z', 'user-1', 'prof-1', '2026-11-01T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO auditoria_phi (id, ocurrido_en, usuario_id, rol, paciente_id, recurso, recurso_id, accion, resultado, created_at)
       VALUES ('ap-1', '2026-11-01T10:00:00.000Z', 'user-1', 'profesional', 'pac-1', 'historia_clinica', 'evt-1', 'leer', 'permitido', '2026-11-01T10:00:00.000Z')`,
    ).run();
    return db;
  }

  it('Dado UPDATE directo en hc_evento Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db
        .prepare(`UPDATE hc_evento SET detalle = 'modificado' WHERE id = 'evt-1'`)
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado DELETE directo en hc_evento Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db.prepare(`DELETE FROM hc_evento WHERE id = 'evt-1'`).run(),
    ).toThrow();
    db.close();
  });

  it('Dado UPDATE directo en odontograma_evento Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db
        .prepare(
          `UPDATE odontograma_evento SET hallazgo = 'modificado' WHERE id = 'oe-1'`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado DELETE directo en odontograma_evento Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db.prepare(`DELETE FROM odontograma_evento WHERE id = 'oe-1'`).run(),
    ).toThrow();
    db.close();
  });

  it('Dado UPDATE directo en auditoria_phi Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db
        .prepare(`UPDATE auditoria_phi SET resultado = 'denegado' WHERE id = 'ap-1'`)
        .run(),
    ).toThrow();
    db.close();
  });

  it('Dado DELETE directo en auditoria_phi Cuando se intenta Entonces trigger aborta', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db.prepare(`DELETE FROM auditoria_phi WHERE id = 'ap-1'`).run(),
    ).toThrow();
    db.close();
  });

  it('Dado usuario.profesional_id duplicado Cuando se inserta segundo usuario Entonces UNIQUE rechaza', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db
        .prepare(
          `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
           VALUES ('user-2', 'prof2@example.test', 'hash', 1, 'prof-1', ?, ?, null)`,
        )
        .run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z'),
    ).toThrow();
    db.close();
  });

  it('Dado usuario.profesional_id inexistente Cuando se asigna Entonces FK rechaza', () => {
    const db = crearDbCon008YDatos();
    expect(() =>
      db
        .prepare(
          `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
           VALUES ('user-3', 'prof3@example.test', 'hash', 1, 'prof-inexistente', ?, ?, null)`,
        )
        .run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z'),
    ).toThrow();
    db.close();
  });
});
