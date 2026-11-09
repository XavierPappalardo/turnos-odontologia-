/**
 * Migración 016: recuperación de inactivos y cobranza automática (C-18).
 * Valida tablas, constraints, índices útiles e idempotencia. SQLite real (R12). Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();
function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name);
}

describe('Migración 016 — recuperacion_cobranza (C-18)', () => {
  it('Dado el registro de migraciones Cuando se inspecciona Entonces existe migración 016', () => {
    const mig = MIGRATIONS.find((m) => m.id === '016');
    expect(mig).toBeDefined();
    expect(mig?.sql).toContain('recuperacion_ejecucion');
    expect(mig?.sql).toContain('recuperacion_contacto');
  });

  it('Dado una base nueva Cuando se ejecutan migraciones Entonces existen tablas y columnas esperadas', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    expect(columnasTabla(db, 'recuperacion_ejecucion')).toEqual(
      expect.arrayContaining(['id', 'tipo', 'estado', 'iniciado_en', 'finalizado_en']),
    );
    expect(columnasTabla(db, 'recuperacion_contacto')).toEqual(
      expect.arrayContaining(['id', 'ejecucion_id', 'tipo', 'paciente_id', 'estado', 'dedupe_clave', 'monto_centavos']),
    );
  });

  it('Dado paciente ficticio y ejecución Cuando se registra contacto simulado Entonces persiste sin PHI', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-r-1','Paciente Ficticio Uno',?,?)`).run(AHORA, AHORA);
    db.prepare(`INSERT INTO recuperacion_ejecucion (id,tipo,estado,parametros_json,resumen_json,iniciado_en,created_at,updated_at) VALUES ('e1','cobranza','completada','{}','{}',?,?,?)`).run(AHORA, AHORA, AHORA);
    db.prepare(
      `INSERT INTO recuperacion_contacto (id,ejecucion_id,tipo,paciente_id,estado,motivo_omision,monto_centavos,dedupe_clave,ventana_hasta,detalle_json,created_at,updated_at)
       VALUES ('c1','e1','cobranza','pac-r-1','enviado_simulado',NULL,5000,'cobranza:pac-r-1:2026-11','2026-12-01T00:00:00.000Z','{}',?,?)`,
    ).run(AHORA, AHORA);
    const row = db.prepare('SELECT estado, monto_centavos FROM recuperacion_contacto WHERE id=?').get('c1') as { estado: string; monto_centavos: number };
    expect(row).toEqual({ estado: 'enviado_simulado', monto_centavos: 5000 });
  });

  it('Dado tipo inválido Cuando se inserta ejecución Entonces falla CHECK', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    expect(() => {
      db.prepare(`INSERT INTO recuperacion_ejecucion (id,tipo,estado,parametros_json,resumen_json,iniciado_en,created_at,updated_at) VALUES ('e2','otro','iniciada','{}','{}',?,?,?)`).run(AHORA, AHORA, AHORA);
    }).toThrow();
  });

  it('Dado migraciones ya ejecutadas Cuando se corre runMigrations nuevamente Entonces es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    expect(runMigrations(db)).toContain('016');
    expect(runMigrations(db)).toHaveLength(0);
    expect(columnasTabla(db, 'recuperacion_contacto')).toContain('dedupe_clave');
  });
});
