/**
 * C-09 task 6.4: HistoriaClinicaService.
 * Registro de eventos clínicos inmutables con enmiendas trazables.
 * Todas las operaciones escriben en `auditoria_phi` dentro de la misma
 * transacción `BEGIN IMMEDIATE` (diseño D11).
 * Errores tipados sin PHI (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { TipoEventoHc } from '../shared/types.js';
import { normalizarIsoUtc } from '../shared/fechas.js';
import {
  ValidacionClinicaError,
  EventoNoEncontradoError,
  EnmiendaDuplicadaError,
} from '../shared/errors.js';
import { HistoriaClinicaRepository } from './historiaClinica.repository.js';
import { AuditoriaPhiRepository } from './auditoriaPhi.repository.js';
import { UnitOfWork } from '../shared/repository.js';

export interface RegistrarEventoInput {
  pacienteId: string;
  tipo: TipoEventoHc;
  detalle: string;
  ocurridoEn: string;
  actorUsuarioId: string;
  profesionalId: string;
  turnoId?: string | null;
}

export interface EventoVigente {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  tipo: string;
  detalle: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  enmienda_de: string | null;
  motivo_enmienda: string | null;
  created_at: string;
  es_vigente: boolean;
}

export interface EnmendarEventoInput {
  pacienteId: string;
  eventoId: string;
  tipo: TipoEventoHc;
  detalle: string;
  motivoEnmienda: string;
  actorUsuarioId: string;
  profesionalId: string;
}

const TIPOS_VALIDOS: readonly TipoEventoHc[] = [
  'consulta',
  'nota',
  'diagnostico',
  'procedimiento',
];

const DETALLE_MIN = 1;
const DETALLE_MAX = 5000;

export class HistoriaClinicaService {
  private readonly repo: HistoriaClinicaRepository;
  private readonly auditoria: AuditoriaPhiRepository;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.repo = new HistoriaClinicaRepository(db);
    this.auditoria = new AuditoriaPhiRepository(db);
    this.uow = new UnitOfWork(db);
  }

  registrarEvento(input: RegistrarEventoInput): EventoVigente {
    this.validarTipo(input.tipo);
    this.validarDetalle(input.detalle);
    const ocurridoEn = this.normalizarOcurridoEn(input.ocurridoEn);
    this.validarTurno(input.pacienteId, input.turnoId);

    const id = crypto.randomUUID();
    const ahora = new Date().toISOString();

    this.uow.runInTransaction(() => {
      this.repo.insertar({
        id,
        paciente_id: input.pacienteId,
        turno_id: input.turnoId ?? null,
        tipo: input.tipo,
        detalle: input.detalle,
        ocurrido_en: ocurridoEn,
        actor_usuario_id: input.actorUsuarioId,
        profesional_id: input.profesionalId,
        created_at: ahora,
      });
      this.auditoria.registrar({
        id: crypto.randomUUID(),
        ocurrido_en: ahora,
        usuario_id: input.actorUsuarioId,
        rol: 'profesional',
        paciente_id: input.pacienteId,
        recurso: 'historia_clinica',
        recurso_id: id,
        accion: 'crear',
        resultado: 'permitido',
        motivo: null,
        ip: null,
        session_id: null,
      });
    });

    const row = this.repo.findById(id);
    if (!row) throw new Error('no se pudo recuperar el evento creado');
    return mapToVigente(row, true);
  }

  listarPorPaciente(
    pacienteId: string,
    turnoId?: string | null,
    usuarioId?: string | null,
    rol?: string | null,
  ): EventoVigente[] {
    const ahora = new Date().toISOString();
    const eventos = this.repo.listarPorPaciente(pacienteId);
    this.auditoria.registrar({
      id: crypto.randomUUID(),
      ocurrido_en: ahora,
      usuario_id: usuarioId ?? 'system',
      rol: rol ?? 'profesional',
      paciente_id: pacienteId,
      recurso: 'historia_clinica',
      recurso_id: null,
      accion: 'leer',
      resultado: 'permitido',
      motivo: null,
      ip: null,
      session_id: null,
    });
    const filtrados = turnoId !== undefined
      ? eventos.filter((e) => e.turno_id === turnoId)
      : eventos;
    return filtrados.map((e) =>
      mapToVigente(e, !this.repo.existeEnmiendaDe(e.id)),
    );
  }

  enmendarEvento(input: EnmendarEventoInput): EventoVigente {
    this.validarTipo(input.tipo);
    this.validarDetalle(input.detalle);
    if (!input.motivoEnmienda || input.motivoEnmienda.trim() === '') {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'motivo_enmienda_requerido',
        message: 'motivo de enmienda inválido',
      });
    }

    const original = this.repo.findById(input.eventoId);
    if (!original || original.paciente_id !== input.pacienteId) {
      throw new EventoNoEncontradoError({
        status: 404,
        code: 'evento_no_encontrado',
        message: 'evento no encontrado para este paciente',
      });
    }

    if (this.repo.existeEnmiendaDe(input.eventoId)) {
      throw new EnmiendaDuplicadaError({
        status: 409,
        code: 'enmienda_duplicada',
        message: 'evento ya enmendado',
      });
    }

    // Hereda ocurrido_en del original (diseño D3)
    const ocurridoEn = original.ocurrido_en;
    const id = crypto.randomUUID();
    const ahora = new Date().toISOString();

    this.uow.runInTransaction(() => {
      this.repo.insertar({
        id,
        paciente_id: input.pacienteId,
        turno_id: original.turno_id,
        tipo: input.tipo,
        detalle: input.detalle,
        ocurrido_en: ocurridoEn,
        actor_usuario_id: input.actorUsuarioId,
        profesional_id: input.profesionalId,
        enmienda_de: input.eventoId,
        motivo_enmienda: input.motivoEnmienda,
        created_at: ahora,
      });
      this.auditoria.registrar({
        id: crypto.randomUUID(),
        ocurrido_en: ahora,
        usuario_id: input.actorUsuarioId,
        rol: 'profesional',
        paciente_id: input.pacienteId,
        recurso: 'historia_clinica',
        recurso_id: id,
        accion: 'crear',
        resultado: 'permitido',
        motivo: null,
        ip: null,
        session_id: null,
      });
    });

    const row = this.repo.findById(id);
    if (!row) throw new Error('no se pudo recuperar el evento de enmienda');
    return mapToVigente(row, true);
  }

  private validarTipo(tipo: string): void {
    if (!TIPOS_VALIDOS.includes(tipo as TipoEventoHc)) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'tipo_evento_invalido',
        message: 'tipo de evento clínico inválido',
      });
    }
  }

  private validarDetalle(detalle: string): void {
    const trimmed = detalle.trim();
    if (trimmed.length < DETALLE_MIN || trimmed.length > DETALLE_MAX) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'detalle_clinico_invalido',
        message: 'detalle clínico inválido',
      });
    }
  }

  private normalizarOcurridoEn(valor: string): string {
    const normalizado = normalizarIsoUtc(valor);
    if (normalizado === undefined) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'ocurrido_en_invalido',
        message: 'ocurrido_en inválido',
      });
    }
    return normalizado;
  }

  private validarTurno(pacienteId: string, turnoId?: string | null): void {
    if (turnoId === undefined || turnoId === null) return;
    const stmt = this.repo['db'].prepare(
      `SELECT 1 FROM turno WHERE id = ? AND paciente_id = ? AND deleted_at IS NULL LIMIT 1`,
    );
    if (stmt.get(turnoId, pacienteId) === undefined) {
      throw new EventoNoEncontradoError({
        status: 404,
        code: 'turno_no_encontrado_para_paciente',
        message: 'turno no encontrado para este paciente',
      });
    }
  }
}

function mapToVigente(
  row: {
    id: string;
    paciente_id: string;
    turno_id: string | null;
    tipo: string;
    detalle: string;
    ocurrido_en: string;
    actor_usuario_id: string;
    profesional_id: string;
    enmienda_de: string | null;
    motivo_enmienda: string | null;
    created_at: string;
  },
  esVigente: boolean,
): EventoVigente {
  return {
    id: row.id,
    paciente_id: row.paciente_id,
    turno_id: row.turno_id,
    tipo: row.tipo,
    detalle: row.detalle,
    ocurrido_en: row.ocurrido_en,
    actor_usuario_id: row.actor_usuario_id,
    profesional_id: row.profesional_id,
    enmienda_de: row.enmienda_de,
    motivo_enmienda: row.motivo_enmienda,
    created_at: row.created_at,
    es_vigente: esVigente,
  };
}
