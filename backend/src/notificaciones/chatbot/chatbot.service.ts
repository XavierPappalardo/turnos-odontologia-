/**
 * Orquestador conversacional determinista (C-16). Reutiliza lógica de agenda
 * (R9/RN-01/02/04/06) y transiciones; sin PHI en respuestas/logs (R1/R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../shared/config.js';
import { AppError, CrearTurnoError, TurnoEstadoError } from '../../shared/errors.js';
import { UnitOfWork } from '../../shared/repository.js';
import type { PacienteId, PrestacionId, ProfesionalId, SillonId, TurnoId } from '../../shared/types.js';
import { BloqueoRepository } from '../../agenda/bloqueo.repository.js';
import { TurnoRepository, type TurnoRow } from '../../agenda/turno.repository.js';
import { cambiarEstadoTurno, puedeTransicionar } from '../../agenda/turnoEstado.service.js';
import { reservarTurnoOnline } from '../../agenda/reservaOnline.service.js';
import { normalizarUtc } from '../../agenda/crearTurno.service.js';
import { cancelarRecordatoriosDeTurno, programarRecordatoriosSeguro } from '../recordatorio.worker.js';
import { ConversacionRepository, type Conversacion, type ConversacionSlots } from './conversacion.repository.js';
import { ChatbotValidationError, type InboundWhatsAppMessage, type OutboundWhatsAppMessage } from './whatsapp.adapter.js';

type Intencion = 'agendar' | 'confirmar' | 'cancelar' | 'reprogramar' | 'ayuda';

const AYUDA =
  'Opciones: agendar, confirmar, cancelar, reprogramar. Responda con la intención y los datos solicitados (IDs opacos).';

function detectarIntencion(texto: string, actual: string | null): Intencion | null {
  const t = texto.toLowerCase().trim();
  if (/\bagendar|reservar|turno nuevo\b/.test(t)) return 'agendar';
  if (/\bconfirmar\b/.test(t)) return 'confirmar';
  if (/\bcancelar\b/.test(t)) return 'cancelar';
  if (/\breprogramar|cambiar horario\b/.test(t)) return 'reprogramar';
  if (/\bayuda|hola|inicio|menu\b/.test(t)) return 'ayuda';
  if (actual === 'agendar' || actual === 'confirmar' || actual === 'cancelar' || actual === 'reprogramar') {
    return actual as Intencion;
  }
  return null;
}

function mergeSlots(base: ConversacionSlots, msg: InboundWhatsAppMessage): ConversacionSlots {
  return {
    ...base,
    ...(msg.pacienteId ? { pacienteId: msg.pacienteId } : {}),
    ...(msg.profesionalId ? { profesionalId: msg.profesionalId } : {}),
    ...(msg.sillonId ? { sillonId: msg.sillonId } : {}),
    ...(msg.prestacionId ? { prestacionId: msg.prestacionId } : {}),
    ...(msg.turnoId ? { turnoId: msg.turnoId } : {}),
    ...(msg.inicio ? { inicio: msg.inicio } : {}),
    ...(msg.fin ? { fin: msg.fin } : {}),
    ...(msg.confirmar ? { confirmar: true } : {}),
  };
}

function faltantesAgendar(slots: ConversacionSlots): string[] {
  const f: string[] = [];
  if (!slots.pacienteId) f.push('paciente_id');
  if (!slots.profesionalId) f.push('profesional_id');
  if (!slots.sillonId) f.push('sillon_id');
  if (!slots.inicio) f.push('inicio');
  if (!slots.fin) f.push('fin');
  return f;
}

function respuesta(
  conversationId: string,
  text: string,
  extra: Partial<OutboundWhatsAppMessage> = {},
): OutboundWhatsAppMessage {
  return { conversationId, text, ...extra };
}

function safeCode(err: unknown): { status: number; code: string; eje?: string } {
  if (err instanceof ChatbotValidationError) return { status: err.status, code: err.code };
  if (err instanceof CrearTurnoError) return { status: err.status, code: err.code, ...(err.eje ? { eje: err.eje } : {}) };
  if (err instanceof TurnoEstadoError) return { status: err.status, code: err.code };
  if (err instanceof AppError) return { status: err.status, code: err.code };
  return { status: 500, code: 'interno' };
}

function cancelarConAnticipacion(db: DatabaseSync, turnoId: string, anticipacionMinSegundos: number, recordatorioConfig: AppConfig['recordatorio']): TurnoRow {
  const turnos = new TurnoRepository(db);
  const actual = turnos.findById(turnoId) as TurnoRow | undefined;
  if (!actual) throw new TurnoEstadoError({ status: 404, code: 'not_found', message: 'turno inexistente' });
  if (!puedeTransicionar(actual.estado, 'cancelado')) {
    throw new TurnoEstadoError({ status: 409, code: 'transicion_invalida', message: 'transición de estado inválida', desde: actual.estado, hacia: 'cancelado' });
  }
  const ahora = new Date();
  const inicioTurno = new Date(actual.inicio);
  const diff = (inicioTurno.getTime() - ahora.getTime()) / 1000;
  if (diff > 0 && diff < anticipacionMinSegundos) {
    throw new CrearTurnoError({ status: 400, code: 'validacion', message: 'anticipación mínima no respetada para cancelación', eje: 'anticipacion' });
  }
  // cambiarEstadoTurno no abre transacción propia grande y maneja recordatorios/confirm program.
  return cambiarEstadoTurno(db, { turnoId, nuevoEstado: 'cancelado', rol: 'recepcion' }, recordatorioConfig);
}

function reprogramarConversacional(
  db: DatabaseSync,
  turnoId: string,
  nuevoInicioRaw: string,
  nuevoFinRaw: string,
  recordatorioConfig: AppConfig['recordatorio'],
): { original: TurnoRow; nuevoId: TurnoId } {
  const uow = new UnitOfWork(db);
  const res = uow.runInTransaction(() => {
    const turnos = new TurnoRepository(db);
    const bloqueos = new BloqueoRepository(db);
    const actual = turnos.findById(turnoId) as TurnoRow | undefined;
    if (!actual) throw new TurnoEstadoError({ status: 404, code: 'not_found', message: 'turno inexistente' });
    if (!puedeTransicionar(actual.estado, 'cancelado')) {
      throw new TurnoEstadoError({ status: 409, code: 'transicion_invalida', message: 'transición de estado inválida', desde: actual.estado, hacia: 'cancelado' });
    }
    const nuevoInicio = normalizarUtc(nuevoInicioRaw, 'nuevo_inicio');
    const nuevoFin = normalizarUtc(nuevoFinRaw, 'nuevo_fin');
    if (nuevoFin <= nuevoInicio) {
      throw new CrearTurnoError({ status: 400, code: 'validacion', message: 'fin debe ser posterior a inicio' });
    }
    const profesionalId = actual.profesional_id as ProfesionalId;
    const sillonId = actual.sillon_id as SillonId;
    const pacienteId = actual.paciente_id as PacienteId;
    if (turnos.existeSolapeProfesional(profesionalId, nuevoInicio, nuevoFin)) {
      throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'solape por profesional', eje: 'profesional', ids: { profesionalId, sillonId, pacienteId } });
    }
    if (turnos.existeSolapeSillon(sillonId, nuevoInicio, nuevoFin)) {
      throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'solape por sillon', eje: 'sillon', ids: { profesionalId, sillonId, pacienteId } });
    }
    if (bloqueos.existeBloqueoAplicable(profesionalId, sillonId, nuevoInicio, nuevoFin)) {
      throw new CrearTurnoError({ status: 409, code: 'conflicto', message: 'bloqueo aplicable', eje: 'bloqueo', ids: { profesionalId, sillonId, pacienteId } });
    }
    const ok = turnos.actualizarEstado(turnoId as TurnoId, actual.estado, 'cancelado');
    if (!ok) {
      throw new TurnoEstadoError({ status: 409, code: 'transicion_invalida', message: 'el turno cambió de estado concurrentemente', desde: actual.estado, hacia: 'cancelado' });
    }
    cancelarRecordatoriosDeTurno(db, turnoId);
    const nuevoId = randomUUID() as TurnoId;
    turnos.crear({
      id: nuevoId,
      profesionalId,
      sillonId,
      pacienteId,
      prestacionId: (actual.prestacion_id ?? undefined) as PrestacionId | undefined,
      inicio: nuevoInicio,
      fin: nuevoFin,
      estado: 'reservado',
      origen: 'online',
    });
    return { original: turnos.findById(turnoId) as TurnoRow, nuevoId, nuevoInicio };
  });
  programarRecordatoriosSeguro(db, res.nuevoId, res.nuevoInicio, recordatorioConfig);
  return { original: res.original, nuevoId: res.nuevoId };
}

export function procesarMensajeChatbot(
  db: DatabaseSync,
  msg: InboundWhatsAppMessage,
  config: AppConfig,
  nowIso: string = new Date().toISOString(),
): OutboundWhatsAppMessage {
  if (!config.chatbot.simuladoHabilitado) {
    return respuesta(msg.conversationId, 'Chatbot simulado deshabilitado.', { code: 'chatbot_deshabilitado', estado: 'deshabilitado' });
  }
  const repo = new ConversacionRepository(db);
  const { conversacion, reiniciadaPorExpiracion } = repo.getOrCreateActive(
    msg.conversationId,
    config.chatbot.sessionTtlSeconds,
    nowIso,
  );
  if (reiniciadaPorExpiracion) {
    return respuesta(msg.conversationId, 'La sesión expiró. Indique: agendar, confirmar, cancelar o reprogramar.', {
      code: 'sesion_expirada',
      estado: 'reiniciada',
    });
  }
  if (conversacion.intentosInvalidos >= config.chatbot.maxIntentosInvalidos) {
    return respuesta(msg.conversationId, 'Se alcanzó el límite de intentos. Inicie nuevamente.', { code: 'limite_intentos', estado: 'limitada' });
  }

  const intencion = detectarIntencion(msg.text, conversacion.intencion);
  if (intencion === null || intencion === 'ayuda') {
    repo.registrarIntentoInvalido(msg.conversationId, config.chatbot.maxIntentosInvalidos, config.chatbot.sessionTtlSeconds, nowIso);
    return respuesta(msg.conversationId, AYUDA, { code: 'ayuda', estado: 'ayuda' });
  }

  const slots = mergeSlots(conversacion.slots, msg);
  try {
    if (intencion === 'agendar') {
      const faltan = faltantesAgendar(slots);
      if (faltan.length > 0) {
        repo.guardar(msg.conversationId, { intencion, paso: 'recolectar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, `Para agendar faltan: ${faltan.join(', ')}.`, { intent: intencion, step: 'recolectar', code: 'faltan_datos' });
      }
      if (!slots.confirmar) {
        repo.guardar(msg.conversationId, { intencion, paso: 'confirmar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, 'Confirme el agendamiento enviando confirmar=true.', { intent: intencion, step: 'confirmar', code: 'requiere_confirmacion' });
      }
      const creado = reservarTurnoOnline(
        db,
        {
          profesionalId: slots.profesionalId!,
          sillonId: slots.sillonId!,
          pacienteId: slots.pacienteId!,
          prestacionId: slots.prestacionId,
          inicio: slots.inicio!,
          fin: slots.fin!,
        },
        config.reservaOnline.anticipacionMinSegundos,
        config.recordatorio,
      );
      repo.guardar(msg.conversationId, { intencion: null, paso: null, slots: {}, intentosInvalidos: 0 }, nowIso);
      return respuesta(msg.conversationId, 'Turno agendado.', { intent: intencion, step: 'completado', code: 'agendado', estado: creado.estado, turnoId: creado.id });
    }

    if (intencion === 'confirmar') {
      if (!slots.turnoId) {
        repo.guardar(msg.conversationId, { intencion, paso: 'recolectar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, 'Para confirmar falta: turno_id.', { intent: intencion, step: 'recolectar', code: 'faltan_datos' });
      }
      if (!slots.confirmar) {
        repo.guardar(msg.conversationId, { intencion, paso: 'confirmar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, 'Confirme la acción enviando confirmar=true.', { intent: intencion, step: 'confirmar', code: 'requiere_confirmacion' });
      }
      const fila = cambiarEstadoTurno(db, { turnoId: slots.turnoId, nuevoEstado: 'confirmado', rol: 'recepcion' }, config.recordatorio);
      repo.guardar(msg.conversationId, { intencion: null, paso: null, slots: {}, intentosInvalidos: 0 }, nowIso);
      return respuesta(msg.conversationId, 'Turno confirmado.', { intent: intencion, step: 'completado', code: 'confirmado', estado: fila.estado, turnoId: fila.id });
    }

    if (intencion === 'cancelar') {
      if (!slots.turnoId) {
        repo.guardar(msg.conversationId, { intencion, paso: 'recolectar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, 'Para cancelar falta: turno_id.', { intent: intencion, step: 'recolectar', code: 'faltan_datos' });
      }
      if (!slots.confirmar) {
        repo.guardar(msg.conversationId, { intencion, paso: 'confirmar', slots, intentosInvalidos: 0 }, nowIso);
        return respuesta(msg.conversationId, 'Confirme la cancelación enviando confirmar=true.', { intent: intencion, step: 'confirmar', code: 'requiere_confirmacion' });
      }
      const fila = cancelarConAnticipacion(db, slots.turnoId, config.reservaOnline.anticipacionMinSegundos, config.recordatorio);
      repo.guardar(msg.conversationId, { intencion: null, paso: null, slots: {}, intentosInvalidos: 0 }, nowIso);
      return respuesta(msg.conversationId, 'Turno cancelado.', { intent: intencion, step: 'completado', code: 'cancelado', estado: fila.estado, turnoId: fila.id });
    }

    // reprogramar
    const faltanR = [!slots.turnoId ? 'turno_id' : null, !slots.inicio ? 'nuevo_inicio/inicio' : null, !slots.fin ? 'nuevo_fin/fin' : null].filter(Boolean) as string[];
    if (faltanR.length > 0) {
      repo.guardar(msg.conversationId, { intencion, paso: 'recolectar', slots, intentosInvalidos: 0 }, nowIso);
      return respuesta(msg.conversationId, `Para reprogramar faltan: ${faltanR.join(', ')}.`, { intent: intencion, step: 'recolectar', code: 'faltan_datos' });
    }
    if (!slots.confirmar) {
      repo.guardar(msg.conversationId, { intencion, paso: 'confirmar', slots, intentosInvalidos: 0 }, nowIso);
      return respuesta(msg.conversationId, 'Confirme la reprogramación enviando confirmar=true.', { intent: intencion, step: 'confirmar', code: 'requiere_confirmacion' });
    }
    const r = reprogramarConversacional(db, slots.turnoId!, slots.inicio!, slots.fin!, config.recordatorio);
    repo.guardar(msg.conversationId, { intencion: null, paso: null, slots: {}, intentosInvalidos: 0 }, nowIso);
    return respuesta(msg.conversationId, 'Turno reprogramado.', { intent: intencion, step: 'completado', code: 'reprogramado', estado: 'reservado', turnoId: r.nuevoId });
  } catch (err) {
    const info = safeCode(err);
    // No registrar PHI; mantener contexto para reintento seguro salvo errores terminales de negocio.
    repo.guardar(msg.conversationId, { intencion, paso: conversacion.paso ?? 'error', slots }, nowIso);
    return respuesta(msg.conversationId, `No se pudo completar la acción (${info.code}).`, {
      intent: intencion,
      step: 'error',
      code: info.code,
      ...(info.eje ? { estado: info.eje } : {}),
    });
  }
}
