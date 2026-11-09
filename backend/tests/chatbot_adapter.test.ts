/**
 * C-16: adaptador WhatsApp simulado y normalización (sin credenciales/PHI).
 * Dado/Cuando/Entonces. Datos ficticios.
 */
import { describe, expect, it } from 'vitest';
import {
  ChatbotValidationError,
  SimulatedWhatsAppAdapter,
  normalizeInboundPayload,
} from '../src/notificaciones/chatbot/whatsapp.adapter.js';

describe('Chatbot WhatsApp adapter simulado (C-16)', () => {
  it('Dado payload simulado válido con IDs opacos Cuando normaliza Entonces devuelve mensaje sin exponer secretos', () => {
    const msg = normalizeInboundPayload({
      conversation_id: 'conv-opaca-001',
      text: 'agendar',
      paciente_id: 'pac-ficticio-1',
    });
    expect(msg.conversationId).toBe('conv-opaca-001');
    expect(msg.text).toBe('agendar');
    expect(msg.pacienteId).toBe('pac-ficticio-1');
    expect(JSON.stringify(msg)).not.toMatch(/password|secret|token|DNI|dni|telefono/i);
  });

  it('Dado payload sin conversation_id Cuando normaliza Entonces rechaza con validación genérica', () => {
    try {
      normalizeInboundPayload({ text: 'hola' });
      expect.fail('debe lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ChatbotValidationError);
      expect((e as ChatbotValidationError).code).toBe('validacion');
      expect((e as ChatbotValidationError).message).not.toMatch(/Paciente|DNI|telefono/i);
    }
  });

  it('Dado payload con conversation_id inválido/arbitrario Cuando normaliza Entonces rechaza sin eco sensible', () => {
    expect(() =>
      normalizeInboundPayload({ conversation_id: 'Juan Perez 12345678', text: 'agendar' }),
    ).toThrow(ChatbotValidationError);
  });

  it('Dado adapter simulado Cuando envía salida Entonces registra mensaje y no llama externos', async () => {
    const adapter = new SimulatedWhatsAppAdapter();
    const out = await adapter.send({ conversationId: 'conv-opaca-002', text: 'ok', code: 'ok' });
    expect(out.conversationId).toBe('conv-opaca-002');
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].code).toBe('ok');
    expect(JSON.stringify(adapter.sent)).not.toMatch(/password|secret|whatsapp_token/i);
  });

  it('Dado text vacío o demasiado largo Cuando normaliza Entonces rechaza', () => {
    expect(() => normalizeInboundPayload({ conversation_id: 'conv-1', text: '' })).toThrow();
    expect(() =>
      normalizeInboundPayload({ conversation_id: 'conv-1', text: 'x'.repeat(501) }),
    ).toThrow();
  });
});
