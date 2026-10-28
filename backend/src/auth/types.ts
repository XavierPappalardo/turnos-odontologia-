import type { Rol, UsuarioId } from '../shared/types.js';

/** Configuración de auth inyectable en app/servidor (C-03). */
export interface AuthConfig {
  readonly jwtSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly loginRateLimitMax: number;
  readonly loginRateLimitWindowSeconds: number;
  readonly cookieSecure: boolean;
}

export interface AuthContext {
  readonly userId: UsuarioId;
  readonly tenantId: string;
  readonly roles: readonly Rol[];
  readonly email: string;
  readonly jti: string;
}

export interface AuthUserView {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly Rol[];
}
