/**
 * C-17 2.1: tokens de acceso portal paciente (emitir/validar/revocar/expirar).
 * SQLite real (R12). Dado/Cuando/Entonces. Sin PHI; token en claro nunca persistido.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { hashToken } from '../src/auth/tokens.js';
import { PortalAccesoService } from '../src/portal/portalAcceso.service.js';

const PAC = 'pac-portal-1';
const AHORA = new Date('2026-11-10T10:00:00.000Z');

function seed(db: DatabaseSync): void {
  const now = AHORA.toISOString();
  db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, 'Paciente Ficticio Uno', ?, ?)`).run(PAC, now, now);
}

let db: DatabaseSync;
let svc: PortalAccesoService;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); svc = new PortalAccesoService(db); });
afterEach(() => { db.close(); });

describe('PortalAccesoService (C-17, 2.1)', () => {
  it('Dado un paciente válido Cuando se emite token Entonces devuelve token opaco y contexto con expiración, sin persistir texto plano', () => {
    const emitido = svc.emitir(PAC, 3600, AHORA);
    expect(emitido.pacienteId).toBe(PAC);
    expect(emitido.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(emitido.token.length).toBeGreaterThan(20);
    expect(emitido.expiresAt).toBe('2026-11-10T11:00:00.000Z');
    const almacenado = db.prepare(`SELECT token_hash FROM portal_paciente_token WHERE id = ?`).get(emitido.tokenId) as { token_hash: string };
    expect(almacenado.token_hash).toBe(hashToken(emitido.token));
    expect(almacenado.token_hash).not.toBe(emitido.token);
  });

  it('Dado token válido no expirado Cuando se valida Entonces resuelve contexto del paciente sin PHI', () => {
    const emitido = svc.emitir(PAC, 3600, AHORA);
    const ctx = svc.validar(emitido.token, '2026-11-10T10:30:00.000Z');
    expect(ctx).toEqual({ pacienteId: PAC, tokenId: emitido.tokenId });
  });

  it('Dado token inválido, ausente o malformado Cuando se valida Entonces error tipado sin PHI', () => {
    try {
      svc.validar('no-existe-token', AHORA.toISOString());
      expect.fail();
    } catch (e) {
      const err = e as { status?: number; code?: string; message?: string };
      expect(err.status).toBe(401);
      expect(err.code).toBe('credenciales_invalidas');
      expect(String(err.message ?? '')).not.toMatch(/Paciente Ficticio|DNI|telefono/i);
    }
    expect(() => svc.validar(undefined, AHORA.toISOString())).toThrow();
    expect(() => svc.validar('', AHORA.toISOString())).toThrow();
  });

  it('Dado token expirado Cuando se valida Entonces rechaza con error tipado', () => {
    const emitido = svc.emitir(PAC, 60, AHORA); // expira 10:01
    expect(() => svc.validar(emitido.token, '2026-11-10T10:02:00.000Z')).toThrow();
    try { svc.validar(emitido.token, '2026-11-10T10:02:00.000Z'); } catch (e) {
      expect((e as { status?: number }).status).toBe(401);
    }
  });

  it('Dado token revocado Cuando se valida Entonces rechaza con error tipado', () => {
    const emitido = svc.emitir(PAC, 3600, AHORA);
    svc.revocar(emitido.tokenId);
    expect(() => svc.validar(emitido.token, '2026-11-10T10:30:00.000Z')).toThrow();
  });

  it('Dado paciente inexistente Cuando se emite Entonces error tipado sin PHI', () => {
    expect(() => svc.emitir('pac-inexistente', 3600, AHORA)).toThrow();
    try { svc.emitir('pac-inexistente', 3600, AHORA); } catch (e) {
      expect((e as { status?: number; code?: string }).status).toBe(404);
      expect((e as { code?: string }).code).toBe('not_found');
    }
  });
});
