/**
 * C-09 task 4.2: AuditoriaPhiService.
 * `registrar()` deriva `session_id` del `jti` (claim opaco del access token),
 * no persiste el token y arma filas `permitido`/`denegado` con `motivo`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AuditoriaPhiRepository } from './auditoriaPhi.repository.js';

export interface AuditoriaPhiRegistrarInput {
  usuario_id: string;
  rol: string;
  paciente_id: string | null;
  recurso: string;
  recurso_id: string | null;
  accion: string;
  resultado: string;
  motivo: string | null;
  ip: string | null;
  jti: string;
  ocurrido_en: string;
}

export class AuditoriaPhiService {
  readonly repo: AuditoriaPhiRepository;

  constructor(db: DatabaseSync) {
    this.repo = new AuditoriaPhiRepository(db);
  }

  registrar(input: AuditoriaPhiRegistrarInput): void {
    // session_id deriva del jti (claim opaco del access token), nunca el token mismo.
    this.repo.registrar({
      id: crypto.randomUUID(),
      ocurrido_en: input.ocurrido_en,
      usuario_id: input.usuario_id,
      rol: input.rol,
      paciente_id: input.paciente_id,
      recurso: input.recurso,
      recurso_id: input.recurso_id,
      accion: input.accion,
      resultado: input.resultado,
      motivo: input.resultado === 'denegado' ? input.motivo : null,
      ip: input.ip,
      session_id: input.jti,
    });
  }
}
