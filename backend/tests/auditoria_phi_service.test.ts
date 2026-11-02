/**
 * C-09 task 4.2: AuditoriaPhiService.
 * `registrar()` deriva `session_id` del `jti`, no persiste el token y
 * arma filas `permitido`/`denegado` con `motivo`.
 */
import { describe, expect, it } from 'vitest';
import { AuditoriaPhiService } from '../src/clinica/auditoriaPhi.service.js';
import { AuditoriaPhiRepository } from '../src/clinica/auditoriaPhi.repository.js';
import { openDatabase } from '../src/shared/repository.js';

function crearServiceConUsuario(): { db: ReturnType<typeof openDatabase>; svc: AuditoriaPhiService } {
  const db = openDatabase(':memory:');
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
     VALUES ('user-1', 'u@example.test', 'hash', 1, null, ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  const svc = new AuditoriaPhiService(db);
  return { db, svc };
}

describe('AuditoriaPhiService.registrar', () => {
  it('Dado jti Cuando registra acceso permitido Entonces session_id deriva del jti y no guarda el token', () => {
    const { svc } = crearServiceConUsuario();
    const jti = 'jti-ficticio-12345';

    svc.registrar({
      usuario_id: 'user-1',
      rol: 'profesional',
      paciente_id: 'pac-1',
      recurso: 'historia_clinica',
      recurso_id: 'evt-1',
      accion: 'leer',
      resultado: 'permitido',
      motivo: null,
      ip: '127.0.0.1',
      jti,
      ocurrido_en: '2026-11-01T10:00:00.000Z',
    });

    const filas = (svc as any).repo.buscarPorUsuario('user-1');
    expect(filas.length).toBe(1);
    expect(filas[0]!.session_id).toBe(jti);
    // session_id no debe ser el token mismo (es un identificador opaco)
    expect(filas[0]!.session_id).not.toMatch(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
  });

  it('Dado resultado denegado con motivo Cuando registra Entonces guarda motivo', () => {
    const { svc } = crearServiceConUsuario();

    svc.registrar({
      usuario_id: 'user-1',
      rol: 'recepcion',
      paciente_id: 'pac-1',
      recurso: 'historia_clinica',
      recurso_id: null,
      accion: 'leer',
      resultado: 'denegado',
      motivo: 'rol_no_autorizado',
      ip: '127.0.0.1',
      jti: 'jti-xyz',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
    });

    const filas = (svc as any).repo.buscarPorUsuario('user-1');
    expect(filas.length).toBe(1);
    expect(filas[0]!.resultado).toBe('denegado');
    expect(filas[0]!.motivo).toBe('rol_no_autorizado');
  });

  it('Dado resultado permitido Cuando registra Entonces motivo es null', () => {
    const { svc } = crearServiceConUsuario();

    svc.registrar({
      usuario_id: 'user-1',
      rol: 'profesional',
      paciente_id: 'pac-1',
      recurso: 'historia_clinica',
      recurso_id: null,
      accion: 'leer',
      resultado: 'permitido',
      motivo: null,
      ip: '127.0.0.1',
      jti: 'jti-abc',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
    });

    const filas = (svc as any).repo.buscarPorUsuario('user-1');
    expect(filas.length).toBe(1);
    expect(filas[0]!.resultado).toBe('permitido');
    expect(filas[0]!.motivo).toBeNull();
  });
});
