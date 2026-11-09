/**
 * Repositorio de tokens de acceso al portal paciente (C-17). R8: acceso vía repo.
 * Solo persiste hash del token; nunca el token en claro ni PHI.
 */
import type { DatabaseSync } from 'node:sqlite';
import { UnitOfWork, nowIsoUtc } from '../shared/repository.js';

export interface PortalTokenRow {
  id: string;
  paciente_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export class PortalAccesoRepository {
  constructor(private readonly db: DatabaseSync) {}

  crear(row: { id: string; pacienteId: string; tokenHash: string; expiresAt: string }): void {
    const uow = new UnitOfWork(this.db);
    uow.runInTransaction(() => {
      const ahora = nowIsoUtc();
      this.db
        .prepare(
          `INSERT INTO portal_paciente_token (id, paciente_id, token_hash, expires_at, revoked_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(row.id, row.pacienteId, row.tokenHash, row.expiresAt, ahora, ahora);
    });
  }

  findByHash(tokenHash: string): PortalTokenRow | undefined {
    return this.db
      .prepare(
        `SELECT id, paciente_id, token_hash, expires_at, revoked_at, created_at, updated_at
         FROM portal_paciente_token WHERE token_hash = ?`,
      )
      .get(tokenHash) as PortalTokenRow | undefined;
  }

  revocar(id: string): boolean {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const result = this.db
        .prepare(
          `UPDATE portal_paciente_token SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL`,
        )
        .run(nowIsoUtc(), nowIsoUtc(), id) as { changes: number };
      return result.changes === 1;
    });
  }

  pacienteExiste(pacienteId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM paciente WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(pacienteId);
    return row !== undefined;
  }
}
