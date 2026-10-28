/**
 * JWT HS256 mínimo con node:crypto (sin dependencias externas).
 * Claims exigidos por C-03: sub, tenant_id, roles, email, jti, type, iat, exp.
 * R3: los tokens NUNCA se loguean ni viajan en query params.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Rol } from '../shared/types.js';

export type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  sub: string;
  tenant_id: string;
  roles: Rol[];
  email: string;
  jti: string;
  type: TokenType;
  iat: number;
  exp: number;
}

export interface SignTokenInput {
  sub: string;
  tenantId: string;
  roles: readonly Rol[];
  email: string;
  type: TokenType;
  ttlSeconds: number;
  jti?: string;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signToken(
  input: SignTokenInput,
  secret: string,
  now: number = nowSeconds(),
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: TokenClaims = {
    sub: input.sub,
    tenant_id: input.tenantId,
    roles: [...input.roles],
    email: input.email,
    jti: input.jti ?? randomUUID(),
    type: input.type,
    iat: now,
    exp: now + input.ttlSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${base64url(sign(unsigned, secret))}`;
}

function isTokenClaims(value: unknown): value is TokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['sub'] === 'string' &&
    typeof v['tenant_id'] === 'string' &&
    Array.isArray(v['roles']) &&
    v['roles'].every((r) => typeof r === 'string') &&
    typeof v['email'] === 'string' &&
    typeof v['jti'] === 'string' &&
    (v['type'] === 'access' || v['type'] === 'refresh') &&
    typeof v['iat'] === 'number' &&
    typeof v['exp'] === 'number'
  );
}

/**
 * Verifica firma, `type` y expiración. Devuelve `undefined` ante cualquier
 * token inválido (no filtra el motivo al cliente).
 */
export function verifyToken(
  token: string,
  secret: string,
  expectedType: TokenType,
  now: number = nowSeconds(),
): TokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, body, signature] = parts;
  if (header === undefined || body === undefined || signature === undefined) {
    return undefined;
  }

  const expected = sign(`${header}.${body}`, secret);
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return undefined;
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isTokenClaims(payload)) return undefined;
  if (payload.type !== expectedType) return undefined;
  if (payload.exp <= now) return undefined;
  return payload;
}

/** Hash opaco para almacenar el refresh token (nunca el token en claro). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
