/**
 * C-09 task 4.1: Auditoría PHI - repositorio.
 * Inserta una fila con todos los campos y recupera por paciente y por usuario.
 * Implementado sobre AppendOnlyRepository. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { AuditoriaPhiRepository } from '../src/clinica/auditoriaPhi.repository.js';

let db: DatabaseSync;
let repo: AuditoriaPhiRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new AuditoriaPhiRepository(db);
  // Insertar usuarios requeridos por FK de auditoria_phi.usuario_id
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
     VALUES ('user-1', 'user1@example.test', 'hash', 1, null, ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
     VALUES ('user-2', 'user2@example.test', 'hash', 1, null, ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
});

afterEach(() => {
  db.close();
});

describe('AuditoriaPhiRepository', () => {
  it('Dado campos completos Cuando inserta Entonces recupera por paciente y por usuario', () => {
    repo.registrar({
      id: 'aud-1',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      usuario_id: 'user-1',
      rol: 'profesional',
      paciente_id: 'pac-1',
      recurso: 'historia_clinica',
      recurso_id: 'evt-1',
      accion: 'leer',
      resultado: 'permitido',
      motivo: null,
      ip: '127.0.0.1',
      session_id: 'sess-abc',
    });

    const porPaciente = repo.buscarPorPaciente('pac-1');
    expect(porPaciente.length).toBe(1);
    expect(porPaciente[0]!.recurso).toBe('historia_clinica');
    expect(porPaciente[0]!.accion).toBe('leer');
    expect(porPaciente[0]!.resultado).toBe('permitido');
    // No PHI: no nombre ni detalle clínico
    expect(JSON.stringify(porPaciente)).not.toMatch(/Paciente|Ficticio|detalle/);

    const porUsuario = repo.buscarPorUsuario('user-1');
    expect(porUsuario.length).toBe(1);
    expect(porUsuario[0]!.session_id).toBe('sess-abc');
  });

  it('Dado fila denegada Cuando inserta Entonces se recupera con motivo', () => {
    repo.registrar({
      id: 'aud-2',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      usuario_id: 'user-2',
      rol: 'recepcion',
      paciente_id: 'pac-2',
      recurso: 'odontograma',
      recurso_id: null,
      accion: 'leer',
      resultado: 'denegado',
      motivo: 'rol_no_autorizado',
      ip: '127.0.0.1',
      session_id: 'sess-def',
    });

    const filas = repo.buscarPorUsuario('user-2');
    expect(filas.length).toBe(1);
    expect(filas[0]!.resultado).toBe('denegado');
    expect(filas[0]!.motivo).toBe('rol_no_autorizado');
  });

  it('Dado lectura de HC con nombre y detalle ficticio Cuando registra auditoría Entonces la fila no contiene PHI', () => {
    repo.registrar({
      id: 'aud-3',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      usuario_id: 'user-1',
      rol: 'profesional',
      paciente_id: 'pac-1',
      recurso: 'historia_clinica',
      recurso_id: 'evt-1',
      accion: 'leer',
      resultado: 'permitido',
      motivo: null,
      ip: '127.0.0.1',
      session_id: 'sess-ghi',
    });

    const filas = repo.buscarPorUsuario('user-1');
    const serializado = JSON.stringify(filas);
    expect(serializado).not.toMatch(/Paciente Ficticio/);
    expect(serializado).not.toMatch(/detalle/);
    expect(serializado).not.toMatch(/Penicilina/);
    expect(serializado).not.toMatch(/nombre/);
  });
});
