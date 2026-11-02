/**
 * C-09 task 1.3: AppendOnlyRepository.
 * Tablas con solo `created_at` (sin `updated_at`). `insert` sella solo
 * `created_at`. `update`/`softDelete` lanzan `EventoInmutableError`.
 * SQLite real en memoria, tabla fixture ficticia.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AppendOnlyRepository, openDatabase } from '../src/shared/repository.js';
import { EventoInmutableError } from '../src/shared/errors.js';

interface EventoFixture {
  id: string;
  paciente_id: string;
  tipo: string;
  detalle: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  created_at: string;
}

function crearDbConTablaEvento(): DatabaseSync {
  const db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE hc_evento_test (
      id TEXT PRIMARY KEY,
      paciente_id TEXT NOT NULL,
      tipo TEXT NOT NULL,
      detalle TEXT NOT NULL,
      ocurrido_en TEXT NOT NULL,
      actor_usuario_id TEXT NOT NULL,
      profesional_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('AppendOnlyRepository', () => {
  it('Dado tabla con solo created_at Cuando inserto Entonces fila creada con created_at y sin updated_at', () => {
    const db = crearDbConTablaEvento();
    const repo = new AppendOnlyRepository<EventoFixture>(db, 'hc_evento_test');
    repo.insert({
      id: 'evt-1',
      paciente_id: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
    });
    const fila = repo.findById('evt-1');
    expect(fila).toBeDefined();
    expect(typeof (fila as EventoFixture).created_at).toBe('string');
    expect(
      (fila as unknown as Record<string, unknown>).updated_at,
    ).toBeUndefined();
    db.close();
  });

  it('Dado repo append-only Cuando llamo update Entonces lanza EventoInmutableError', () => {
    const db = crearDbConTablaEvento();
    const repo = new AppendOnlyRepository<EventoFixture>(db, 'hc_evento_test');
    expect(() =>
      repo.update('evt-1', { detalle: 'cambio' }),
    ).toThrow(EventoInmutableError);
    db.close();
  });

  it('Dado repo append-only Cuando llamo softDelete Entonces lanza EventoInmutableError', () => {
    const db = crearDbConTablaEvento();
    const repo = new AppendOnlyRepository<EventoFixture>(db, 'hc_evento_test');
    expect(() => repo.softDelete('evt-1')).toThrow(EventoInmutableError);
    db.close();
  });

  it('Dado repo append-only Cuando inserto y cuento Entonces countAll funciona', () => {
    const db = crearDbConTablaEvento();
    const repo = new AppendOnlyRepository<EventoFixture>(db, 'hc_evento_test');
    expect(repo.countAll()).toBe(0);
    repo.insert({
      id: 'evt-1',
      paciente_id: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
    });
    expect(repo.countAll()).toBe(1);
    db.close();
  });
});
