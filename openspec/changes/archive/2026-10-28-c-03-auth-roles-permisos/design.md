# Design: C-03 auth-roles-permisos

## Auth
- JWT HS256 implementado con `node:crypto` (sin dependencias nuevas).
- Claims: `sub`, `tenant_id`, `roles`, `email`, `jti`, `type`, `iat`, `exp`.
- Access token en body (`Authorization: Bearer`); refresh en cookie `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` en producción.
- Rotación de refresh + blacklist en tabla `refresh_token` (hash SHA-256, nunca el token en claro).
- Reutilización de un token revocado invalida toda la familia del usuario.

## RBAC
Roles: `recepcion`, `profesional`, `administracion`.
- `requireAuth(jwtSecret)` valida el access token y publica `res.locals.auth`.
- `requireRoles(...)` aplica la matriz; agenda exige `recepcion`/`administracion`.
- Errores `401 {error:"no_autenticado"}` / `403 {error:"forbidden"}` sin PHI.

## Rate limiting
- 5 intentos / 60 s por IP+email (configurable por entorno).
- En memoria e inyectable en tiempo (tests sin esperas reales); `429` + `Retry-After`.

## Persistencia
- Migración 002: `usuario`, `usuario_rol`.
- Migración 005: `refresh_token` (rotación/blacklist) + `usuario.deleted_at`.
- Repositorios `UsuarioRepository` y `RefreshTokenRepository` sobre `BaseRepository`/`UnitOfWork`.

## Seguridad
- Contraseñas con scrypt (N=16384, r=8, p=1) + comparación timing-safe.
- Comparación de firma JWT timing-safe; `JWT_SECRET` mínimo 32 caracteres (fail-fast).
- R3: nunca se loguean tokens, cookies, contraseñas, hashes ni PHI.
