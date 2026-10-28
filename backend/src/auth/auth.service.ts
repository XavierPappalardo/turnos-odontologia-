/**
 * Servicio de autenticación (C-03).
 * Login → access JWT + refresh opaco en cookie HttpOnly.
 * Refresh → rotación atómica + detección de reutilización (blacklist).
 * Logout → revoca el refresh. Sin PHI ni secretos en logs (R3/R15).
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AuthError } from '../shared/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { LoginRateLimiter } from './rate-limit.js';
import {
  RefreshTokenRepository,
  UsuarioRepository,
  type UsuarioRow,
} from './auth.repository.js';
import { hashToken, signToken, verifyToken } from './tokens.js';
import type { AuthConfig, AuthUserView } from './types.js';

const TENANT_ID = 'default';
// Hash ficticio para igualar el costo de verificación cuando el email no existe.
const DUMMY_HASH = hashPassword('dummy-password-not-real');

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: AuthUserView;
}

export class AuthService {
  private readonly db: DatabaseSync;
  private readonly config: AuthConfig;
  private readonly usuarios: UsuarioRepository;
  private readonly refreshTokens: RefreshTokenRepository;
  private readonly limiter: LoginRateLimiter;

  constructor(db: DatabaseSync, config: AuthConfig) {
    this.db = db;
    this.config = config;
    this.usuarios = new UsuarioRepository(db);
    this.refreshTokens = new RefreshTokenRepository(db);
    this.limiter = new LoginRateLimiter({
      max: config.loginRateLimitMax,
      windowSeconds: config.loginRateLimitWindowSeconds,
    });
  }

  login(email: string, password: string, ip: string): LoginResult {
    const normalizedEmail = email.trim().toLowerCase();
    const limit = this.limiter.intentar(`${ip}|${normalizedEmail}`);
    this.limiter.limpiar();
    if (!limit.allowed) {
      throw new AuthError({
        status: 429,
        code: 'demasiados_intentos',
        message: 'demasiados intentos de login',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const usuario = this.usuarios.findByEmail(normalizedEmail);
    const passwordOk = verifyPassword(
      password,
      usuario?.password_hash ?? DUMMY_HASH,
    );
    if (
      usuario === undefined ||
      usuario.activo !== 1 ||
      usuario.deleted_at !== null ||
      !passwordOk
    ) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'credenciales inválidas',
      });
    }

    return this.emitir(usuario);
  }

  refresh(refreshToken: string): LoginResult {
    const claims = verifyToken(refreshToken, this.config.jwtSecret, 'refresh');
    if (claims === undefined) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'refresh inválido',
      });
    }

    const tokenHash = hashToken(refreshToken);
    const fila = this.refreshTokens.findByHash(tokenHash);
    if (fila === undefined) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'refresh inválido',
      });
    }

    // Reutilización de un refresh ya rotado/revocado → se invalida la familia.
    if (fila.revoked_at !== null) {
      this.refreshTokens.revocarTodos(fila.usuario_id);
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'refresh reutilizado',
      });
    }
    if (new Date(fila.expires_at).getTime() <= Date.now()) {
      this.refreshTokens.revocar(fila.id);
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'refresh expirado',
      });
    }

    const usuario = this.usuarios.findActivoById(fila.usuario_id);
    if (usuario === undefined) {
      this.refreshTokens.revocar(fila.id);
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'usuario inactivo',
      });
    }

    return this.rotar(fila.id, usuario);
  }

  logout(refreshToken: string | undefined): void {
    if (refreshToken === undefined) return;
    const tokenHash = hashToken(refreshToken);
    const fila = this.refreshTokens.findByHash(tokenHash);
    if (fila !== undefined && fila.revoked_at === null) {
      this.refreshTokens.revocar(fila.id);
    }
  }

  me(userId: string): AuthUserView {
    const usuario = this.usuarios.findActivoById(userId);
    if (usuario === undefined) {
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'usuario inactivo',
      });
    }
    return this.view(usuario, this.usuarios.rolesDe(usuario.id));
  }

  private rotar(
    refreshId: string,
    usuario: UsuarioRow,
  ): LoginResult {
    const roles = this.usuarios.rolesDe(usuario.id);
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const accessToken = signToken(
      {
        sub: usuario.id,
        tenantId: TENANT_ID,
        roles,
        email: usuario.email,
        type: 'access',
        ttlSeconds: this.config.accessTokenTtlSeconds,
        jti: accessJti,
      },
      this.config.jwtSecret,
    );
    const refreshToken = signToken(
      {
        sub: usuario.id,
        tenantId: TENANT_ID,
        roles,
        email: usuario.email,
        type: 'refresh',
        ttlSeconds: this.config.refreshTokenTtlSeconds,
        jti: refreshJti,
      },
      this.config.jwtSecret,
    );

    // Rotación atómica: revocar el anterior + crear el nuevo. Si otra solicitud
    // ganó la carrera, se revoca la familia fuera de esta transacción (para que
    // el ROLLBACK no deshaga la blacklist) y se rechaza.
    this.db.exec('BEGIN IMMEDIATE');
    let revocado = false;
    try {
      revocado = this.refreshTokens.revocar(refreshId, refreshJti);
      if (revocado) {
        this.refreshTokens.crear({
          id: refreshJti,
          usuarioId: usuario.id,
          tokenHash: hashToken(refreshToken),
          expiresAt: new Date(
            (Math.floor(Date.now() / 1000) + this.config.refreshTokenTtlSeconds) *
              1000,
          ).toISOString(),
        });
        this.db.exec('COMMIT');
      } else {
        this.db.exec('ROLLBACK');
      }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // conservar error original
      }
      throw err;
    }

    if (!revocado) {
      this.refreshTokens.revocarTodos(usuario.id);
      throw new AuthError({
        status: 401,
        code: 'credenciales_invalidas',
        message: 'refresh reutilizado',
      });
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      user: this.view(usuario, roles),
    };
  }

  private emitir(usuario: UsuarioRow): LoginResult {
    const roles = this.usuarios.rolesDe(usuario.id);
    const refreshJti = randomUUID();
    const accessToken = signToken(
      {
        sub: usuario.id,
        tenantId: TENANT_ID,
        roles,
        email: usuario.email,
        type: 'access',
        ttlSeconds: this.config.accessTokenTtlSeconds,
      },
      this.config.jwtSecret,
    );
    const refreshToken = signToken(
      {
        sub: usuario.id,
        tenantId: TENANT_ID,
        roles,
        email: usuario.email,
        type: 'refresh',
        ttlSeconds: this.config.refreshTokenTtlSeconds,
        jti: refreshJti,
      },
      this.config.jwtSecret,
    );

    this.refreshTokens.crear({
      id: refreshJti,
      usuarioId: usuario.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(
        (Math.floor(Date.now() / 1000) + this.config.refreshTokenTtlSeconds) *
          1000,
      ).toISOString(),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      user: this.view(usuario, roles),
    };
  }

  private view(usuario: UsuarioRow, roles: readonly string[]): AuthUserView {
    return {
      id: usuario.id,
      email: usuario.email,
      roles: roles as AuthUserView['roles'],
    };
  }
}
