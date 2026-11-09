/**
 * Repositorio de estado conversacional (C-16). R8: acceso a datos solo vía repo.
 * Sin PHI: conversation_id/slots son IDs opacos o referencias ficticias.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { UnitOfWork, nowIsoUtc } from '../../shared/repository.js';
import { ChatbotValidationError } from './whatsapp.adapter.js';

export interface ConversacionSlots {
  pacienteId?: string;
  profesionalId?: string;
  sillonId?: string;
  prestacionId?: string;
  turnoId?: string;
  inicio?: string;
  fin?: string;
  nuevoInicio?: string;
  nuevoFin?: string;
  confirmar?: boolean;
}

export interface ConversacionRow {
  id: string;
  conversation_id: string;
  intencion: string | null;
  paso: string | null;
  slots_json: string;
  intentos_invalidos: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface Conversacion {
  id: string;
  conversationId: string;
  intencion: string | null;
  paso: string | null;
  slots: ConversacionSlots;
  intentosInvalidos: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

function parseSlots(json: string): ConversacionSlots {
  try {
    const v = JSON.parse(json) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as ConversacionSlots;
  } catch {
    /* ignore */
  }
  return {};
}

function toDomain(row: ConversacionRow): Conversacion {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    intencion: row.intencion,
    paso: row.paso,
    slots: parseSlots(row.slots_json),
    intentosInvalidos: row.intentos_invalidos,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversacionRepository {
  constructor(private readonly db: DatabaseSync) {}

  findByConversationId(conversationId: string): Conversacion | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, intencion, paso, slots_json, intentos_invalidos, expires_at, created_at, updated_at
         FROM chatbot_conversacion WHERE conversation_id = ?`,
      )
      .get(conversationId) as ConversacionRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  /** Obtiene o crea sesión activa; si expiró, la reinicia. */
  getOrCreateActive(
    conversationId: string,
    ttlSeconds: number,
    nowIso: string = nowIsoUtc(),
  ): { conversacion: Conversacion; reiniciadaPorExpiracion: boolean } {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const actual = this.findByConversationId(conversationId);
      const expiresAt = new Date(new Date(nowIso).getTime() + ttlSeconds * 1000).toISOString();
      if (!actual) {
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO chatbot_conversacion
             (id, conversation_id, intencion, paso, slots_json, intentos_invalidos, expires_at, created_at, updated_at)
             VALUES (?, ?, NULL, NULL, '{}', 0, ?, ?, ?)`,
          )
          .run(id, conversationId, expiresAt, nowIso, nowIso);
        return { conversacion: this.findByConversationId(conversationId)!, reiniciadaPorExpiracion: false };
      }
      if (actual.expiresAt <= nowIso) {
        this.db
          .prepare(
            `UPDATE chatbot_conversacion
             SET intencion = NULL, paso = NULL, slots_json = '{}', intentos_invalidos = 0, expires_at = ?, updated_at = ?
             WHERE conversation_id = ?`,
          )
          .run(expiresAt, nowIso, conversationId);
        return { conversacion: this.findByConversationId(conversationId)!, reiniciadaPorExpiracion: true };
      }
      return { conversacion: actual, reiniciadaPorExpiracion: false };
    });
  }

  guardar(
    conversationId: string,
    patch: {
      intencion?: string | null;
      paso?: string | null;
      slots?: ConversacionSlots;
      intentosInvalidos?: number;
      expiresAt?: string;
    },
    nowIso: string = nowIsoUtc(),
  ): Conversacion {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const actual = this.findByConversationId(conversationId);
      if (!actual) throw new ChatbotValidationError('conversacion_no_encontrada', 400);
      this.db
        .prepare(
          `UPDATE chatbot_conversacion
           SET intencion = ?, paso = ?, slots_json = ?, intentos_invalidos = ?, expires_at = ?, updated_at = ?
           WHERE conversation_id = ?`,
        )
        .run(
          patch.intencion !== undefined ? patch.intencion : actual.intencion,
          patch.paso !== undefined ? patch.paso : actual.paso,
          JSON.stringify(patch.slots !== undefined ? patch.slots : actual.slots),
          patch.intentosInvalidos !== undefined ? patch.intentosInvalidos : actual.intentosInvalidos,
          patch.expiresAt ?? actual.expiresAt,
          nowIso,
          conversationId,
        );
      return this.findByConversationId(conversationId)!;
    });
  }

  registrarIntentoInvalido(
    conversationId: string,
    maxIntentos: number,
    ttlSeconds: number,
    nowIso: string = nowIsoUtc(),
  ): { conversacion: Conversacion; limitado: boolean } {
    const { conversacion } = this.getOrCreateActive(conversationId, ttlSeconds, nowIso);
    const intentos = conversacion.intentosInvalidos + 1;
    const limitado = intentos >= maxIntentos;
    const actualizada = this.guardar(
      conversationId,
      limitado
        ? { intentosInvalidos: intentos, intencion: null, paso: null, slots: {} }
        : { intentosInvalidos: intentos },
      nowIso,
    );
    return { conversacion: actualizada, limitado };
  }
}
