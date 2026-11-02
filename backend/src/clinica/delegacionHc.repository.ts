/**
 * C-09 task 5.3: DelegacionHcRepository.
 * Tabla `delegacion_hc` (solo created_at, sin updated_at). Insert-only.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';

export interface DelegacionHcRow {
  id: string;
  paciente_id: string;
  profesional_id: string;
  otorgada_por_usuario_id: string;
  desde: string;
  hasta: string;
  motivo: string;
  revocada_en: string | null;
  created_at: string;
}

export interface DelegacionHcInput {
  id: string;
  paciente_id: string;
  profesional_id: string;
  otorgada_por_usuario_id: string;
  desde: string;
  hasta: string;
  motivo: string;
}

export class DelegacionHcRepository extends AppendOnlyRepository<DelegacionHcRow> {
  constructor(db: DatabaseSync) {
    super(db, 'delegacion_hc');
  }

  crear(input: DelegacionHcInput): void {
    this.insert({
      id: input.id,
      paciente_id: input.paciente_id,
      profesional_id: input.profesional_id,
      otorgada_por_usuario_id: input.otorgada_por_usuario_id,
      desde: input.desde,
      hasta: input.hasta,
      motivo: input.motivo,
      revocada_en: null,
    } as unknown as Omit<DelegacionHcRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }
}
