# Proposal: C-03 auth-roles-permisos

## Objetivo
Implementar autenticación + RBAC alineado a actores (recepción, profesional, administración).

## Alcance
- Modelos `usuario`, `usuario_rol` y `refresh_token` (rotación/blacklist)
- Endpoints auth (login, refresh, logout, me)
- RBAC por recurso (matriz de roles)
- JWT HS256 con claims exigidos
- Refresh en cookie HttpOnly, rotación y blacklist
- Rate limiting de login
- Migraciones 002 (auth) y 005 (refresh/soft-delete)

## Dependencias
C-02 core-models

## Resultado
Implementado y verificado con `tests/auth.test.ts` + `tests/config.test.ts`.
Autenticación real reemplaza el stub `x-role`; agenda consume JWT + RBAC.

## Preparación
Skill `core-models-scaffolder` + KB (`03-actores.md`, `05-reglas-negocio.md`, `07-flujos.md`, `08-arquitectura.md`).
