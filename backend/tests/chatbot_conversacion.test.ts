/**
 * C-16: estado conversacional (TTL, límites, persistencia). SQLite real (R12).
 * Dado/Cuando/Entonces. Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { ConversacionRepository } from '../src/notificaciones/chatbot/conversacion.repository.js';

const TTL = 1800;
const MAX_INTENTOS = 3;

function crearDb(): DatabaseSync {
  return openDatabase(':memory:');
}

describe('ConversacionRepository (C-16)', () => {
  it('Dado una conversación nueva Cuando se obtiene activa Entonces crea sesión con slots vacíos', () => {
    const db = crearDb();
    const repo = new ConversacionRepository(db);
    const ahora = '2026-11-10T10:00:00.000Z';
    const { conversacion, reiniciadaPorExpiracion } = repo.getOrCreateActive('conv-opaca-a', TTL, ahora);
    expect(reiniciadaPorExpiracion).toBe(false);
    expect(conversacion.conversationId).toBe('conv-opaca-a');
    expect(conversacion.intencion).toBeNull();
    expect(conversacion.slots).toEqual({});
    expect(conversacion.intentosInvalidos).toBe(0);
    db.close();
  });

  it('Dado un flujo multi-paso Cuando se guardan intención y slots opacos Entonces persiste el contexto', () => {
    const db = crearDb();
    const repo = new ConversacionRepository(db);
    const ahora = '2026-11-10T10:00:00.000Z';
    repo.getOrCreateActive('conv-opaca-b', TTL, ahora);
    repo.guardar('conv-opaca-b', {
      intencion: 'agendar',
      paso: 'pedir_horario',
      slots: { pacienteId: 'pac-ficticio-1', profesionalId: 'prof-ficticio-1' },
    }, ahora);
    const c = repo.findByConversationId('conv-opaca-b');
    expect(c?.intencion).toBe('agendar');
    expect(c?.paso).toBe('pedir_horario');
    expect(c?.slots.pacienteId).toBe('pac-ficticio-1');
    expect(JSON.stringify(c)).not.toMatch(/DNI|telefono|Paciente Ejemplo/i);
    db.close();
  });

  it('Dado una sesión expirada Cuando llega un nuevo mensaje Entonces reinicia el flujo sin ejecutar contexto vencido', () => {
    const db = crearDb();
    const repo = new ConversacionRepository(db);
    repo.getOrCreateActive('conv-opaca-c', TTL, '2026-11-10T10:00:00.000Z');
    repo.guardar('conv-opaca-c', {
      intencion: 'agendar',
      paso: 'confirmar',
      slots: { pacienteId: 'pac-ficticio-1' },
    }, '2026-11-10T10:05:00.000Z');
    const { conversacion, reiniciadaPorExpiracion } = repo.getOrCreateActive(
      'conv-opaca-c',
      TTL,
      '2026-11-10T11:00:00.000Z',
    );
    expect(reiniciadaPorExpiracion).toBe(true);
    expect(conversacion.intencion).toBeNull();
    expect(conversacion.paso).toBeNull();
    expect(conversacion.slots).toEqual({});
    db.close();
  });

  it('Dado intentos inválidos repetidos Cuando se supera el máximo Entonces limita y reinicia la conversación', () => {
    const db = crearDb();
    const repo = new ConversacionRepository(db);
    const ahora = '2026-11-10T10:00:00.000Z';
    repo.getOrCreateActive('conv-opaca-d', TTL, ahora);
    repo.registrarIntentoInvalido('conv-opaca-d', MAX_INTENTOS, TTL, ahora);
    repo.registrarIntentoInvalido('conv-opaca-d', MAX_INTENTOS, TTL, ahora);
    const r = repo.registrarIntentoInvalido('conv-opaca-d', MAX_INTENTOS, TTL, ahora);
    expect(r.limitado).toBe(true);
    expect(r.conversacion.intentosInvalidos).toBe(3);
    expect(r.conversacion.intencion).toBeNull();
    expect(r.conversacion.slots).toEqual({});
    db.close();
  });
});
