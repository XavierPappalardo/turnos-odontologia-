/**
 * Adaptador WhatsApp desacoplado (C-16): interfaz + simulador sin credenciales reales.
 * Sin llamadas externas (R15). Payloads/errores sin PHI (R1/R3).
 */
import { AppError } from '../../shared/errors.js';

export interface InboundWhatsAppMessage {
  /** Identificador opaco de conversación (no teléfono real en modo simulado). */
  conversationId: string;
  /** Texto/comando ingresado por el usuario simulado. */
  text: string;
  /** Referencias opacas/ficticias opcionales (solo IDs, nunca PHI). */
  pacienteId?: string;
  profesionalId?: string;
  sillonId?: string;
  prestacionId?: string;
  turnoId?: string;
  inicio?: string;
  fin?: string;
  /** Confirmación explícita antes de mutar agenda. */
  confirmar?: boolean;
}

export interface OutboundWhatsAppMessage {
  conversationId: string;
  text: string;
  intent?: string;
  step?: string;
  estado?: string;
  turnoId?: string;
  code?: string;
}

export interface WhatsAppAdapter {
  normalizeInbound(payload: unknown): InboundWhatsAppMessage;
  send(message: OutboundWhatsAppMessage): Promise<OutboundWhatsAppMessage> | OutboundWhatsAppMessage;
}

export class ChatbotValidationError extends AppError {
  constructor(code: string, status = 400) {
    super({ status, code, message: code });
    this.name = 'ChatbotValidationError';
  }
}

const MAX_TEXT = 500;
const MAX_ID = 120;

function asOpaqueId(value: unknown, _campo: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ChatbotValidationError('validacion');
  const v = value.trim();
  if (v === '' || v.length > MAX_ID) throw new ChatbotValidationError('validacion');
  // Solo caracteres seguros para IDs opacos; evita eco de contenido arbitrario/PHI.
  if (!/^[a-zA-Z0-9._:-]+$/.test(v)) throw new ChatbotValidationError('validacion');
  return v;
}

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new ChatbotValidationError('validacion');
  const v = value.trim();
  if (v === '' || v.length > MAX_TEXT) throw new ChatbotValidationError('validacion');
  return v;
}

export function normalizeInboundPayload(payload: unknown): InboundWhatsAppMessage {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ChatbotValidationError('validacion');
  }
  const p = payload as Record<string, unknown>;
  const conversationId = asOpaqueId(p.conversation_id ?? p.conversationId, 'conversation_id');
  if (conversationId === undefined) throw new ChatbotValidationError('validacion');
  const text = asText(p.text ?? p.message ?? p.body);
  const msg: InboundWhatsAppMessage = { conversationId, text, confirmar: p.confirmar === true || p.confirmar === 'true' };
  const pacienteId = asOpaqueId(p.paciente_id ?? p.pacienteId, 'paciente_id');
  if (pacienteId !== undefined) msg.pacienteId = pacienteId;
  const profesionalId = asOpaqueId(p.profesional_id ?? p.profesionalId, 'profesional_id');
  if (profesionalId !== undefined) msg.profesionalId = profesionalId;
  const sillonId = asOpaqueId(p.sillon_id ?? p.sillonId, 'sillon_id');
  if (sillonId !== undefined) msg.sillonId = sillonId;
  const prestacionId = asOpaqueId(p.prestacion_id ?? p.prestacionId, 'prestacion_id');
  if (prestacionId !== undefined) msg.prestacionId = prestacionId;
  const turnoId = asOpaqueId(p.turno_id ?? p.turnoId, 'turno_id');
  if (turnoId !== undefined) msg.turnoId = turnoId;
  if (typeof p.inicio === 'string' && p.inicio.trim() !== '' && p.inicio.length <= 40) msg.inicio = p.inicio.trim();
  if (typeof p.fin === 'string' && p.fin.trim() !== '' && p.fin.length <= 40) msg.fin = p.fin.trim();
  return msg;
}

export class SimulatedWhatsAppAdapter implements WhatsAppAdapter {
  readonly sent: OutboundWhatsAppMessage[] = [];

  normalizeInbound(payload: unknown): InboundWhatsAppMessage {
    return normalizeInboundPayload(payload);
  }

  send(message: OutboundWhatsAppMessage): OutboundWhatsAppMessage {
    this.sent.push(message);
    return message;
  }
}
