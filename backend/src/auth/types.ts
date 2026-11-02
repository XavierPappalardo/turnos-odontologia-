import type { ProfesionalId, Rol, UsuarioId } from '../shared/types.js';
export type { ProfesionalId };

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
  /** `usuario.profesional_id` resuelto por request desde la BD (C-09, D4). */
  readonly profesionalId?: ProfesionalId;
}

export interface AuthUserView {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly Rol[];
  readonly profesional_id: string | null;
}
