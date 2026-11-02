/**
 * C-09 task 2.5: PacienteRepository.
 * `findVigente` (activo=1, deleted_at IS NULL) y actualización de
 * `fecha_nacimiento`/`alergias`. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { PacienteRepository } from '../src/core/paciente.repository.js';
import type { PacienteRow } from '../src/core/models.js';

let db: DatabaseSync;
let repo: PacienteRepository;

function crearPaciente(overrides: Partial<PacienteRow> = {}): PacienteRow {
  const now = '2026-11-01T10:00:00.000Z';
  return {
    id: overrides.id ?? 'pac-1',
    nombre: overrides.nombre ?? 'Paciente Ficticio',
    telefono_whatsapp: overrides.telefono_whatsapp ?? '+54 9 11 0000-0000',
    obra_social_plan_id: overrides.obra_social_plan_id ?? null,
    activo: overrides.activo ?? 1,
    fecha_nacimiento: overrides.fecha_nacimiento ?? null,
    alergias: overrides.alergias ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PacienteRepository(db);
  repo.insert(crearPaciente());
});

afterEach(() => {
  db.close();
});

describe('PacienteRepository.findVigente', () => {
  it('Dado paciente activo Cuando findVigente Entonces lo devuelve', () => {
    const p = repo.findVigente('pac-1');
    expect(p).toBeDefined();
    expect(p?.nombre).toBe('Paciente Ficticio');
  });

  it('Dado paciente dado de baja Cuando findVigente Entonces devuelve undefined', () => {
    repo.softDelete('pac-1');
    const p = repo.findVigente('pac-1');
    expect(p).toBeUndefined();
  });

  it('Dado paciente inexistente Cuando findVigente Entonces devuelve undefined', () => {
    const p = repo.findVigente('pac-inexistente');
    expect(p).toBeUndefined();
  });
});

describe('PacienteRepository actualización de datos clínicos', () => {
  it('Dado paciente Cuando actualiza fecha_nacimiento y alergias Entonces se persisten', () => {
    const ok = repo.actualizarDatosClinicos('pac-1', {
      fecha_nacimiento: '1990-05-20',
      alergias: 'Penicilina ficticia',
    });
    expect(ok).toBe(true);
    const p = repo.findVigente('pac-1')!;
    expect(p.fecha_nacimiento).toBe('1990-05-20');
    expect(p.alergias).toBe('Penicilina ficticia');
  });

  it('Dado paciente Cuando actualiza solo fecha_nacimiento Entonces alergias se conserva', () => {
    repo.actualizarDatosClinicos('pac-1', { alergias: 'Polen ficticio' });
    repo.actualizarDatosClinicos('pac-1', { fecha_nacimiento: '1985-01-01' });
    const p = repo.findVigente('pac-1')!;
    expect(p.fecha_nacimiento).toBe('1985-01-01');
    expect(p.alergias).toBe('Polen ficticio');
  });

  it('Dado alergias vacía Cuando actualiza Entonces se normaliza a NULL', () => {
    repo.actualizarDatosClinicos('pac-1', { alergias: 'Penicilina ficticia' });
    repo.actualizarDatosClinicos('pac-1', { alergias: '' });
    const p = repo.findVigente('pac-1')!;
    expect(p.alergias).toBeNull();
  });

  it('Dado paciente inexistente Cuando actualiza Entonces devuelve false', () => {
    const ok = repo.actualizarDatosClinicos('pac-inexistente', {
      fecha_nacimiento: '1990-05-20',
    });
    expect(ok).toBe(false);
  });

  it('Dado paciente dado de baja Cuando actualiza Entonces devuelve false', () => {
    repo.softDelete('pac-1');
    const ok = repo.actualizarDatosClinicos('pac-1', {
      fecha_nacimiento: '1990-05-20',
    });
    expect(ok).toBe(false);
  });
});
