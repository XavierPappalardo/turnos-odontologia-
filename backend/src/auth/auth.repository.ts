/**
 * Repositorios de auth (R8: todo SQL vive aquí).
 * `UsuarioRepository` maneja usuarios/roles; `RefreshTokenRepository` la
 * blacklist con rotación (C-03).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository, nowIsoUtc, UnitOfWork } from '../shared/repository.js';
import type { Rol, UsuarioId } from '../shared/types.js';

export interface UsuarioRow {
  id: string;
  email: string;
  password_hash: string;
  activo: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RefreshTokenRow {
  id: string;
  usuario_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  created_at: string;
  updated_at: string;
}

export class UsuarioRepository extends BaseRepository<UsuarioRow> {
  constructor(db: DatabaseSync) {
    super(db, 'usuario');
  }

  findByEmail(email: string): UsuarioRow | undefined {
    return this.db
      .prepare('SELECT * FROM usuario WHERE email = ? AND deleted_at IS NULL')
      .get(email) as UsuarioRow | undefined;
  }

  findActivoById(id: string): UsuarioRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM usuario WHERE id = ? AND activo = 1 AND deleted_at IS NULL',
      )
      .get(id) as UsuarioRow | undefined;
  }

  rolesDe(usuarioId: string): Rol[] {
    const rows = this.db
      .prepare('SELECT rol FROM usuario_rol WHERE usuario_id = ? ORDER BY rol')
      .all(usuarioId) as { rol: Rol }[];
    return rows.map((r) => r.rol);
  }

  crear(args: {
    id: UsuarioId;
    email: string;
    passwordHash: string;
    roles: readonly Rol[];
  }): void {
    const uow = new UnitOfWork(this.db);
    uow.runInTransaction(() => {
      this.insert({
        id: args.id,
        email: args.email,
        password_hash: args.passwordHash,
        activo: 1,
        deleted_at: null,
      });
      const insertRol = this.db.prepare(
        'INSERT OR IGNORE INTO usuario_rol (usuario_id, rol) VALUES (?, ?)',
      );
      for (const rol of args.roles) insertRol.run(args.id, rol);
    });
  }
}

export class RefreshTokenRepository extends BaseRepository<RefreshTokenRow> {
  constructor(db: DatabaseSync) {
    super(db, 'refresh_token');
  }

  crear(args: {
    id: string;
    usuarioId: string;
    tokenHash: string;
    expiresAt: string;
  }): void {
    this.insert({
      id: args.id,
      usuario_id: args.usuarioId,
      token_hash: args.tokenHash,
      expires_at: args.expiresAt,
      revoked_at: null,
      replaced_by: null,
    });
  }

  findByHash(tokenHash: string): RefreshTokenRow | undefined {
    return this.db
      .prepare('SELECT * FROM refresh_token WHERE token_hash = ?')
      .get(tokenHash) as RefreshTokenRow | undefined;
  }

  revocar(id: string, replacedBy?: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE refresh_token
            SET revoked_at = ?, replaced_by = ?, updated_at = ?
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(nowIsoUtc(), replacedBy ?? null, nowIsoUtc(), id);
    return result.changes === 1;
  }

  revocarTodos(usuarioId: string): void {
    const now = nowIsoUtc();
    this.db
      .prepare(
        `UPDATE refresh_token
            SET revoked_at = ?, updated_at = ?
          WHERE usuario_id = ? AND revoked_at IS NULL`,
      )
      .run(now, now, usuarioId);
  }
}
