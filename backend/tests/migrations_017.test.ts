/**
 * Migración 017: solicitud automática de reseñas post-atención (C-19).
 * Valida tabla, constraints, índices e idempotencia. SQLite real (R12). Sin PHI/secretos.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name);
}

describe('Migración 017 — solicitud_resena (C-19)', () => {
  it('Dado el registro de migraciones Cuando se inspecciona Entonces existe migración 017', () => {
    const mig = MIGRATIONS.find((m) => m.id === '017');
    expect(mig).toBeDefined();
    expect(mig?.sql).toContain('solicitud_resena');
    expect(mig?.sql).not.toMatch(/whatsapp_api|google_api|credential|password/i);
  });

  it('Dado una base nueva Cuando se ejecutan migraciones Entonces existe tabla con columnas esperadas', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    expect(columnasTabla(db, 'solicitud_resena')).toEqual(
      expect.arrayContaining([
        'id',
        'turno_id',
        'paciente_id',
        'canal',
        'link_ref',
        'estado',
        'motivo_omision',
        'dedupe_clave',
        'ventana_hasta',
        'detalle_json',
        'created_at',
        'updated_at',
      ]),
    );
  });

  it('Dado turno/paciente ficticios Cuando se registra solicitud simulada Entonces persiste sin PHI', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-r1','Prof Ficticio',1,?,?)`).run(AHORA, AHORA);
    db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sil-r1','Sillon Ficticio',1,?,?)`).run(AHORA, AHORA);
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-r1','Paciente Ficticio Uno',?,?)`).run(AHORA, AHORA);
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('tur-r1','prof-r1','sil-r1','pac-r1','2026-11-01T10:00:00.000Z','2026-11-01T10:30:00.000Z','atendido','recepcion',?,?)`,
    ).run(AHORA, AHORA);
    db.prepare(
      `INSERT INTO solicitud_resena (id,turno_id,paciente_id,canal,link_ref,estado,motivo_omision,dedupe_clave,ventana_hasta,detalle_json,created_at,updated_at)
       VALUES ('sr1','tur-r1','pac-r1','whatsapp','ref:config','enviado_simulado',NULL,'resena:tur-r1',NULL,'{}',?,?)`,
    ).run(AHORA, AHORA);
    const row = db
      .prepare('SELECT estado, canal, turno_id FROM solicitud_resena WHERE id=?')
      .get('sr1') as { estado: string; canal: string; turno_id: string };
    expect(row).toEqual({ estado: 'enviado_simulado', canal: 'whatsapp', turno_id: 'tur-r1' });
  });

  it('Dado estado inválido Cuando se inserta solicitud Entonces falla CHECK', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-r2','Prof Ficticio',1,?,?)`).run(AHORA, AHORA);
    db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sil-r2','Sillon Ficticio',1,?,?)`).run(AHORA, AHORA);
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-r2','Paciente Ficticio Dos',?,?)`).run(AHORA, AHORA);
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('tur-r2','prof-r2','sil-r2','pac-r2','2026-11-01T11:00:00.000Z','2026-11-01T11:30:00.000Z','atendido','recepcion',?,?)`,
    ).run(AHORA, AHORA);
    expect(() => {
      db.prepare(
        `INSERT INTO solicitud_resena (id,turno_id,paciente_id,canal,link_ref,estado,dedupe_clave,detalle_json,created_at,updated_at)
         VALUES ('sr2','tur-r2','pac-r2','whatsapp','ref:config','otro','x','{}',?,?)`,
      ).run(AHORA, AHORA);
    }).toThrow();
  });

  it('Dado migraciones ya ejecutadas Cuando se corre runMigrations nuevamente Entonces es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    expect(runMigrations(db)).toContain('017');
    expect(runMigrations(db)).toHaveLength(0);
    expect(columnasTabla(db, 'solicitud_resena')).toContain('dedupe_clave');
  });
});
