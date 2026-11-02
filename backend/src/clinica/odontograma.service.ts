/**
 * C-09 task 7.3: OdontogramaService.
 * Registro de eventos del odontograma con validación FDI (pieza→superficie)
 * y enmiendas trazables. Diseño D7: pieza→superficie como regla de dominio pura.
 * Errores tipados sin PHI (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  esCombinacionValida,
  esPiezaFdiValida,
  esSuperficieValida,
} from './fdi.js';
import { normalizarIsoUtc } from '../shared/fechas.js';
import {
  ValidacionClinicaError,
  EventoNoEncontradoError,
  EnmiendaDuplicadaError,
} from '../shared/errors.js';
import { OdontogramaRepository } from './odontograma.repository.js';
import { AuditoriaPhiRepository } from './auditoriaPhi.repository.js';
import { UnitOfWork } from '../shared/repository.js';

export interface RegistrarEventoInput {
  pacienteId: string;
  pieza: number;
  superficie: string;
  hallazgo: string;
  ocurridoEn: string;
  actorUsuarioId: string;
  profesionalId: string;
  turnoId?: string | null;
}

export interface EventoVigente {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  pieza_fdi: number;
  superficie: string;
  hallazgo: string;
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
  pieza: number;
  superficie: string;
  hallazgo: string;
  motivoEnmienda: string;
  actorUsuarioId: string;
  profesionalId: string;
}

const HALLAZGOS_VALIDOS = new Set([
  'sano', 'caries', 'obturado', 'ausente', 'corona', 'endodoncia',
  'implante', 'extraccion_indicada', 'sellante', 'fractura',
]);

export class OdontogramaService {
  private readonly repo: OdontogramaRepository;
  private readonly auditoria: AuditoriaPhiRepository;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.repo = new OdontogramaRepository(db);
    this.auditoria = new AuditoriaPhiRepository(db);
    this.uow = new UnitOfWork(db);
  }

  registrarEvento(input: RegistrarEventoInput): EventoVigente {
    this.validarPieza(input.pieza);
    this.validarSuperficie(input.superficie);
    this.validarCombinacion(input.pieza, input.superficie);
    this.validarHallazgo(input.hallazgo);
    const ocurridoEn = this.normalizarOcurridoEn(input.ocurridoEn);
    this.validarTurno(input.pacienteId, input.turnoId);

    const id = crypto.randomUUID();
    const ahora = new Date().toISOString();

    this.uow.runInTransaction(() => {
      this.repo.insertar({
        id,
        paciente_id: input.pacienteId,
        turno_id: input.turnoId ?? null,
        pieza_fdi: input.pieza,
        superficie: input.superficie,
        hallazgo: input.hallazgo,
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
        recurso: 'odontograma',
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

  enmendarEvento(input: EnmendarEventoInput): EventoVigente {
    this.validarPieza(input.pieza);
    this.validarSuperficie(input.superficie);
    this.validarCombinacion(input.pieza, input.superficie);
    this.validarHallazgo(input.hallazgo);
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
        pieza_fdi: input.pieza,
        superficie: input.superficie,
        hallazgo: input.hallazgo,
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
        recurso: 'odontograma',
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

  estadoActual(pacienteId: string): EventoVigente[] {
    const filas = this.repo.estadoActual(pacienteId);
    return filas.map((f) => ({
      id: f.evento_id,
      paciente_id: pacienteId,
      turno_id: null,
      pieza_fdi: f.pieza_fdi,
      superficie: f.superficie,
      hallazgo: f.hallazgo,
      ocurrido_en: f.ocurrido_en,
      actor_usuario_id: '',
      profesional_id: '',
      enmienda_de: null,
      motivo_enmienda: null,
      created_at: '',
      es_vigente: !this.repo.existeEnmiendaDe(f.evento_id),
    }));
  }

  historialPorPieza(pacienteId: string, piezaFdi: number): EventoVigente[] {
    const filas = this.repo.historialPorPieza(pacienteId, piezaFdi);
    return filas.map((f) => mapToVigente(f as any, !this.repo.existeEnmiendaDe(f.id)));
  }

  private validarPieza(pieza: number): void {
    if (!esPiezaFdiValida(pieza)) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'pieza_fdi_invalida',
        message: 'pieza FDI inválida',
      });
    }
  }

  private validarSuperficie(superficie: string): void {
    if (!esSuperficieValida(superficie)) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'superficie_invalida',
        message: 'superficie inválida',
      });
    }
  }

  private validarCombinacion(pieza: number, superficie: string): void {
    if (!esCombinacionValida(pieza, superficie)) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'combinacion_invalida',
        message: 'combinación pieza-superficie inválida',
      });
    }
  }

  private validarHallazgo(hallazgo: string): void {
    if (!HALLAZGOS_VALIDOS.has(hallazgo)) {
      throw new ValidacionClinicaError({
        status: 400,
        code: 'hallazgo_invalido',
        message: 'hallazgo inválido',
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
    pieza_fdi: number;
    superficie: string;
    hallazgo: string;
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
    pieza_fdi: row.pieza_fdi,
    superficie: row.superficie,
    hallazgo: row.hallazgo,
    ocurrido_en: row.ocurrido_en,
    actor_usuario_id: row.actor_usuario_id,
    profesional_id: row.profesional_id,
    enmienda_de: row.enmienda_de,
    motivo_enmienda: row.motivo_enmienda,
    created_at: row.created_at,
    es_vigente: esVigente,
  };
}
