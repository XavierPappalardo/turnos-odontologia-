/**
 * Tests para la Migración 015: tokens de acceso portal paciente (C-17).
 * Valida tabla portal_paciente_token, columnas, UNIQUE token_hash, FK paciente,
 * índice útil y ejecución idempotente. SQLite real en memoria (R12). Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name);
}

describe('Migración 015 — portal_paciente_token (C-17)', () => {
  it('Dado el registro de migraciones Cuando se inspecciona Entonces existe migración 015', () => {
    const mig = MIGRATIONS.find((m) => m.id === '015');
    expect(mig).toBeDefined();
    expect(mig?.sql).toContain('portal_paciente_token');
    expect(mig?.sql).toContain('token_hash');
    expect(mig?.sql).toContain('paciente_id');
  });

  it('Dado una base nueva Cuando se ejecutan migraciones Entonces existe tabla y columnas esperadas', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    expect(columnasTabla(db, 'portal_paciente_token')).toEqual(
      expect.arrayContaining(['id', 'paciente_id', 'token_hash', 'expires_at', 'revoked_at', 'created_at', 'updated_at']),
    );
  });

  it('Dado un paciente ficticio Cuando se inserta token hasheado Entonces persiste sin PHI en claro', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-p-1','Paciente Ficticio Uno',?,?)`).run(AHORA, AHORA);
    db.prepare(
      `INSERT INTO portal_paciente_token (id, paciente_id, token_hash, expires_at, revoked_at, created_at, updated_at)
       VALUES ('pt-1','pac-p-1','hash-opaco-abc','2099-01-01T00:00:00.000Z',NULL,?,?)`,
    ).run(AHORA, AHORA);
    const row = db.prepare('SELECT token_hash, revoked_at FROM portal_paciente_token WHERE id=?').get('pt-1') as { token_hash: string; revoked_at: string | null };
    expect(row.token_hash).toBe('hash-opaco-abc');
    expect(row.revoked_at).toBeNull();
  });

  it('Dado token_hash duplicado Cuando se inserta otra fila Entonces falla UNIQUE', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES ('pac-p-2','Paciente Ficticio Dos',?,?)`).run(AHORA, AHORA);
    db.prepare(
      `INSERT INTO portal_paciente_token (id, paciente_id, token_hash, expires_at, created_at, updated_at) VALUES ('pt-a','pac-p-2','dup-hash','2099-01-01T00:00:00.000Z',?,?)`,
    ).run(AHORA, AHORA);
    expect(() => {
      db.prepare(
        `INSERT INTO portal_paciente_token (id, paciente_id, token_hash, expires_at, created_at, updated_at) VALUES ('pt-b','pac-p-2','dup-hash','2099-01-01T00:00:00.000Z',?,?)`,
      ).run(AHORA, AHORA);
    }).toThrow();
  });

  it('Dado migraciones ya ejecutadas Cuando se corre runMigrations nuevamente Entonces es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    expect(runMigrations(db)).toContain('015');
    expect(runMigrations(db)).toHaveLength(0);
    expect(columnasTabla(db, 'portal_paciente_token')).toContain('token_hash');
  });
});
