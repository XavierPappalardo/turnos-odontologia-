/**
 * Tests para la Migración 014: Estado conversacional chatbot WhatsApp simulado (C-16).
 * Valida tabla chatbot_conversacion, columnas, UNIQUE conversation_id,
 * defaults y ejecución idempotente. SQLite real en memoria (R12).
 * Sin PHI: solo IDs opacos/ejemplos ficticios (R1/R3).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  ).map((c) => c.name);
}

describe('Migración 014 — chatbot_conversacion (C-16)', () => {
  it('Dado el registro de migraciones Cuando se inspecciona Entonces existe migración 014', () => {
    const mig014 = MIGRATIONS.find((m) => m.id === '014');
    expect(mig014).toBeDefined();
    expect(mig014?.sql).toContain('chatbot_conversacion');
    expect(mig014?.sql).toContain('conversation_id');
  });

  it('Dado una base nueva Cuando se ejecutan migraciones Entonces existe tabla y columnas esperadas', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    const cols = columnasTabla(db, 'chatbot_conversacion');
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'conversation_id',
        'intencion',
        'paso',
        'slots_json',
        'intentos_invalidos',
        'expires_at',
        'created_at',
        'updated_at',
      ]),
    );
  });

  it('Dado una conversación ficticia Cuando se inserta con defaults Entonces persiste valores seguros sin PHI', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(
      `INSERT INTO chatbot_conversacion (id, conversation_id, expires_at, created_at, updated_at)
       VALUES ('conv-row-1', 'conv-opaca-001', ?, ?, ?)`,
    ).run(AHORA, AHORA, AHORA);
    const row = db
      .prepare(
        'SELECT slots_json, intentos_invalidos FROM chatbot_conversacion WHERE conversation_id = ?',
      )
      .get('conv-opaca-001') as { slots_json: string; intentos_invalidos: number };
    expect(row.slots_json).toBe('{}');
    expect(row.intentos_invalidos).toBe(0);
  });

  it('Dado conversation_id duplicado Cuando se inserta otra fila Entonces falla UNIQUE', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.prepare(
      `INSERT INTO chatbot_conversacion (id, conversation_id, expires_at, created_at, updated_at)
       VALUES ('conv-row-a', 'conv-opaca-dup', ?, ?, ?)`,
    ).run(AHORA, AHORA, AHORA);
    expect(() => {
      db.prepare(
        `INSERT INTO chatbot_conversacion (id, conversation_id, expires_at, created_at, updated_at)
         VALUES ('conv-row-b', 'conv-opaca-dup', ?, ?, ?)`,
      ).run(AHORA, AHORA, AHORA);
    }).toThrow();
  });

  it('Dado migraciones ya ejecutadas Cuando se corre runMigrations nuevamente Entonces es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    const primera = runMigrations(db);
    expect(primera).toContain('014');
    const segunda = runMigrations(db);
    expect(segunda).toHaveLength(0);
    expect(columnasTabla(db, 'chatbot_conversacion')).toContain('conversation_id');
  });
});
