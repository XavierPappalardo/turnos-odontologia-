# Backend — turnos-odontologia

Monolito modular **TypeScript + Node.js/Express + SQLite (`node:sqlite`) + Vitest** (R7).
Forma parte del cimiento `C-01` (`platform/foundation`) y sobre él implementa
`C-02 core-models`, `C-03 auth-roles-permisos` y `C-04 agenda-turnos-overlaps`.

## Requisitos

- **Node.js `>= 22.5`** (usa `node:sqlite` → `DatabaseSync`). Verificado en `v24.20.0`.
- npm.

## Comandos autoritativos

> Fuente autoritativa de cómo instalar, verificar y correr (KB-08 §5).

| Comando | Qué hace |
|---|---|
| `npm install` | Instala dependencias. |
| `npm run typecheck` | `tsc --noEmit` — verificación de tipos, sin emitir. |
| `npm test` | `vitest run` — suite backend (foundation, core-models, auth y agenda). |
| `npm run build` | `tsc -p tsconfig.json` — compila a `dist/`. |
| `npm run dev` | Compila y levanta el servidor con watch (`tsc` + `node --watch`), cargando `.env` si existe. |
| `npm run seed` | Carga datos ficticios idempotentes + usuarios de los tres roles (requiere `SEED_PASSWORD`). |
| `npm run ci` | `typecheck` + `test` + `build` — usado por el workflow de CI. |

> **Prerrequisito de `dev`/`seed`:** el arranque es fail-fast (design D2) — requiere
> `PORT`, `DATABASE_PATH`, `NODE_ENV` y `JWT_SECRET` (mínimo 32 caracteres). Copiá el
> ejemplo antes de arrancar: `cp .env.example .env` (el `.env` está gitignored, R15).

## Auth (C-03)

- `POST /api/auth/login` → access token JWT HS256 en el body + refresh en cookie
  `HttpOnly`, `SameSite=Lax`, `Secure` en producción (`Path=/api/auth`).
- `POST /api/auth/refresh` → rotación atómica del refresh; reutilizar uno revocado
  invalida toda la familia (blacklist en `refresh_token`).
- `POST /api/auth/logout` → revoca el refresh y limpia la cookie.
- `GET /api/auth/me` → usuario y roles del access token.
- Rate limit de login configurable (default 5 intentos / 60 s por IP+email → `429`).
- Roles: `recepcion`, `profesional`, `administracion`. Solo recepción/administración
  crean turnos y cambian estados. Sin PHI ni secretos en logs (R3).

Credenciales de seed **ficticias** (`npm run seed` + `SEED_PASSWORD`):
`admin@example.test`, `recepcion@example.test`, `profesional@example.test`.

## Modelos core (C-02)

Migraciones `004` (obra social/plan, pago, auditoría/soft-delete) y `005`
(refresh tokens) completan el esquema. Reglas garantizadas por SQLite:

- `monto_centavos INTEGER >= 0` y `moneda = 'ARS'` (R2/R5), sin floats.
- `cobertura_pct` entero `0..100` (R6).
- `fin > inicio`, FKs y CHECKs de estados/medios.
- Soft-delete vía `deleted_at`; seed idempotente con datos ficticios (R1/R12).

## Inventario absorbido del scaffold C-04 (preservado)

Registrado por inspección del repositorio y de los imports del test existente. Estas
piezas NO se remodelan; las piezas nuevas (config, logger, runner de migraciones,
error middleware, server) se agregan **alrededor**.

| Archivo | Rol observado | Acción C-01 |
|---|---|---|
| `package.json` | deps `express`; devDeps `typescript`/`vitest`/`supertest`/`@types/*`; scripts `dev`/`build`/`test`/`typecheck` | Absorbido; `dev` levanta el servidor y se agregan `engines.node` + `ci` |
| `tsconfig.json` | strict, `noImplicitAny`, `exactOptionalPropertyTypes`, target ES2022 | Absorbido |
| `vitest.config.ts` | env `node`, `tests/**/*.test.ts` | Absorbido |
| `.env.example` | variables de entorno sin secretos | Absorbido; ampliado |
| `.gitignore` | ignora `node_modules/`, `dist/`, `.env`, `*.db*`, `coverage/` | Absorbido |
| `src/shared/app.ts` | factory `createApp(db, authConfig)` + `GET /api/health` → `{status:'ok'}`; monta auth + `turnosRouter` | Actualizado para auth real |
| `src/shared/repository.ts` | `BaseRepository<T>`, `UnitOfWork` (`BEGIN IMMEDIATE`), `openDatabase` (001→005), `applyMigration003`, `AuditMixin`/`auditStamp` | Ampliado con soft-delete e inserción idempotente |
| `src/shared/migrations.ts` | constantes SQL `001`..`005` | Ampliado con C-02/C-03 |
| `src/shared/types.ts` | brand types (`TurnoId`≠`ProfesionalId`≠…) + estados + `Rol` | Absorbido (R10) |
| `src/shared/errors.ts` | `CrearTurnoError`/`AuthError`/`TurnoEstadoError` con `toBody()` sin PHI | Generalizado bajo `AppError` |
| `src/shared/auth.ts` | matriz RBAC (roles autorizados a crear/cambiar estado) | Reemplaza el stub `x-role` |
| `src/agenda/*` | repos turno/bloqueo, `crearTurno.service.ts`, `turnoEstado.service.ts`, `turnos.routes.ts` | Ampliado con máquina de estados C-04 |
| `tests/crear_turno.test.ts` | 20 escenarios Vitest sobre SQLite real | Adaptado a JWT; sigue verde |

## Contratos principales

```ts
import { BloqueoRepository } from '../src/agenda/bloqueo.repository.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { applyMigration003, openDatabase } from '../src/shared/repository.js';
import type { PacienteId, ProfesionalId, SillonId } from '../src/shared/types.js';
```

- `createApp(db, authConfig)` → `Express`; `GET /api/health` → `200 {"status":"ok"}`;
  monta `/api/auth/*` y `turnosRouter`.
- `openDatabase(path?)` → `DatabaseSync` con migraciones 001→005 aplicadas; `:memory:` por defecto.
- `applyMigration003(db)` → aplica la migración 003 (delegando en el runner).
- `BaseRepository<T>`, `UnitOfWork` (`BEGIN IMMEDIATE`), `AuditMixin`/`auditStamp`, `insertOrIgnore`.
- `CrearTurnoError`/`TurnoEstadoError`/`AuthError` con `status`, ids opacos y `toBody()`; brand types.
- `turnosRouter(db, authConfig)` → `Router` con `POST /api/turnos` y
  `PATCH /api/turnos/:id/estado`, ambos con JWT + RBAC.
- Máquina de estados: `reservado → confirmado → presente → atendido`;
  `reservado|confirmado → cancelado`; `confirmado → ausente`.

Verificación: `npm run ci` (typecheck + test + build) en verde.
