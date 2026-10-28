# Tasks: C-03 auth-roles-permisos

## Preparación
- [x] Consultar KB (`03-actores.md`, `05-reglas-negocio.md`, `07-flujos.md`, `08-arquitectura.md`)
- [x] Aplicar guía de `core-models-scaffolder` (repositorios/UoW/auditoría)

## Implementación
- [x] Modelos `usuario` + `usuario_rol` (migración 002) y `refresh_token` con blacklist (migración 005)
- [x] Endpoints auth: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- [x] RBAC middleware (`requireAuth`, `requireRoles`) + matriz reutilizable en `shared/auth.ts`
- [x] JWT HS256 con `sub`, `tenant_id`, `roles`, `email`, `jti`, `type`, `iat`, `exp` (node:crypto)
- [x] Refresh en cookie HttpOnly/Lax/Secure (prod) con rotación atómica y detección de reutilización
- [x] Rate limiting de login 5/60 s configurable
- [x] Hash de contraseñas con scrypt y hash SHA-256 de refresh tokens
- [x] Validación fail-fast de `JWT_SECRET` (mínimo 32) y TTLs en `loadConfig`
- [x] Seed idempotente de usuarios ficticios para los tres roles (`SEED_PASSWORD`)
- [x] Tests (`tests/auth.test.ts`, `tests/config.test.ts`)

## Verificación
- [x] Escenario 1: login válido → access token + refresh HttpOnly/Lax
- [x] Escenario 2: RBAC → profesional recibe `403`; sin/invalid token `401`
- [x] Escenario 3: refresh reutilizado → `401` y revocación de la familia
- [x] Escenario 4: rate limit → `429` + `Retry-After`
- [x] Escenario 5: logout revoca refresh y limpia cookie
- [x] `npm run typecheck` + `npm test` verdes (sin datos reales, R1/R3)
