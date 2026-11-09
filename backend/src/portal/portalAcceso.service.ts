/**
 * Servicio de acceso al portal paciente (C-17).
 * Tokens opacos hasheados, asociados a un único paciente, con expiración/revocación.
 * Nunca expone PHI ni token en claro en errores/logs.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from '../auth/tokens.js';
import { AppError } from '../shared/errors.js';
import { PortalAccesoRepository } from './portalAcceso.repository.js';

export interface PortalAccesoEmitido {
  token: string; // solo en emisión; nunca persistir/loguear
  tokenId: string;
  pacienteId: string;
  expiresAt: string;
}

export interface PortalContexto {
  pacienteId: string;
  tokenId: string;
}

function tokenInvalido(): AppError {
  return new AppError({ status: 401, code: 'credenciales_invalidas', message: 'acceso inválido' });
}

export class PortalAccesoService {
  private readonly repo: PortalAccesoRepository;

  constructor(private readonly db: DatabaseSync) {
    this.repo = new PortalAccesoRepository(db);
  }

  emitir(pacienteId: string, ttlSeconds: number, ahora: Date = new Date()): PortalAccesoEmitido {
    if (!this.repo.pacienteExiste(pacienteId)) {
      throw new AppError({ status: 404, code: 'not_found', message: 'recurso no encontrado' });
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(ahora.getTime() + ttlSeconds * 1000).toISOString();
    const tokenId = randomUUID();
    this.repo.crear({ id: tokenId, pacienteId, tokenHash, expiresAt });
    return { token, tokenId, pacienteId, expiresAt };
  }

  validar(tokenPlano: string | undefined, ahoraIso: string = new Date().toISOString()): PortalContexto {
    if (typeof tokenPlano !== 'string' || tokenPlano.trim() === '') throw tokenInvalido();
    const tokenHash = hashToken(tokenPlano.trim());
    const row = this.repo.findByHash(tokenHash);
    if (!row) throw tokenInvalido();
    if (row.revoked_at !== null) throw tokenInvalido();
    if (row.expires_at <= ahoraIso) throw tokenInvalido();
    return { pacienteId: row.paciente_id, tokenId: row.id };
  }

  revocar(tokenId: string): void {
    const ok = this.repo.revocar(tokenId);
    if (!ok) throw new AppError({ status: 404, code: 'not_found', message: 'recurso no encontrado' });
  }
}
