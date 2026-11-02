/**
 * C-09 task 4.1: AuditoriaPhiRepository sobre AppendOnlyRepository.
 * Tabla `auditoria_phi` (solo created_at, sin updated_at). Insert-only.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';

export interface AuditoriaPhiRow {
  id: string;
  ocurrido_en: string;
  usuario_id: string;
  rol: string;
  paciente_id: string | null;
  recurso: string;
  recurso_id: string | null;
  accion: string;
  resultado: string;
  motivo: string | null;
  ip: string | null;
  session_id: string | null;
  created_at: string;
}

export interface AuditoriaPhiInput {
  id: string;
  ocurrido_en: string;
  usuario_id: string;
  rol: string;
  paciente_id: string | null;
  recurso: string;
  recurso_id: string | null;
  accion: string;
  resultado: string;
  motivo: string | null;
  ip: string | null;
  session_id: string | null;
}

export class AuditoriaPhiRepository extends AppendOnlyRepository<AuditoriaPhiRow> {
  constructor(db: DatabaseSync) {
    super(db, 'auditoria_phi');
  }

  registrar(input: AuditoriaPhiInput): void {
    this.insert({
      id: input.id,
      ocurrido_en: input.ocurrido_en,
      usuario_id: input.usuario_id,
      rol: input.rol,
      paciente_id: input.paciente_id,
      recurso: input.recurso,
      recurso_id: input.recurso_id,
      accion: input.accion,
      resultado: input.resultado,
      motivo: input.motivo,
      ip: input.ip,
      session_id: input.session_id,
    } as unknown as Omit<AuditoriaPhiRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }

  buscarPorPaciente(pacienteId: string): AuditoriaPhiRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM auditoria_phi WHERE paciente_id = ? ORDER BY ocurrido_en DESC, id DESC`,
    );
    return stmt.all(pacienteId) as unknown as AuditoriaPhiRow[];
  }

  buscarPorUsuario(usuarioId: string): AuditoriaPhiRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM auditoria_phi WHERE usuario_id = ? ORDER BY ocurrido_en DESC, id DESC`,
    );
    return stmt.all(usuarioId) as unknown as AuditoriaPhiRow[];
  }
}
