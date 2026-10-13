# Backend — turnos-odontologia

Monolito modular **TypeScript + Node.js/Express + SQLite (`node:sqlite`) + Vitest** (R7).
Forma parte del cimiento `C-01` (`platform/foundation`): absorbe y completa el scaffold
dejado por el change archivado `C-04` **sin remodelarlo**. `src/agenda/*` pertenece a
C-04 y permanece **intacto**.

## Requisitos

- **Node.js `>= 22.5`** (usa `node:sqlite` → `DatabaseSync`). Verificado en `v24.20.0`.
- npm.

## Comandos autoritativos

> Fuente autoritativa de cómo instalar, verificar y correr (KB-08 §5).

| Comando | Qué hace |
|---|---|
| `npm install` | Instala dependencias. |
| `npm run typecheck` | `tsc --noEmit` — verificación de tipos, sin emitir. |
| `npm test` | `vitest run` — suite backend (incluye `crear_turno.test.ts` de C-04). |
| `npm run build` | `tsc -p tsconfig.json` — compila a `dist/`. |
| `npm run dev` | Compila y levanta el servidor con watch (`tsc` + `node --watch`), cargando `.env` si existe. |
| `npm run ci` | `typecheck` + `test` + `build` — usado por el workflow de CI. |

> **Prerrequisito de `dev`:** el arranque es fail-fast (design D2) — requiere
> `PORT`, `DATABASE_PATH` y `NODE_ENV`. Copiá el ejemplo antes de arrancar:
> `cp .env.example .env` (el `.env` está gitignored, R15).

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
| `src/shared/app.ts` | factory `createApp(db)` + `GET /api/health` → `{status:'ok'}`; monta `turnosRouter` | Absorbido; se enchufa error middleware |
| `src/shared/repository.ts` | `BaseRepository<T>`, `UnitOfWork` (`BEGIN IMMEDIATE`), `openDatabase` (001→003), `applyMigration003`, `AuditMixin`/`auditStamp` | Preservado; `openDatabase`/`applyMigration003` delegan en el runner |
| `src/shared/migrations.ts` | constantes SQL `MIGRATION_001_CORE`, `_002_AUTH`, `_003_TURNO_BLOQUEO` | Preservado; se agrega registro ordenado + `runMigrations` |
| `src/shared/types.ts` | brand types (`TurnoId`≠`ProfesionalId`≠…) + estados | Absorbido (R10) |
| `src/shared/errors.ts` | `CrearTurnoError` tipada con `toBody()` sin PHI; `EjeConflicto` | Preservado; generalizado bajo `AppError` |
| `src/shared/auth.ts` | stub RBAC (`x-role`) `[Supuesto]` C-03 | Preservado (C-01 no reimplementa auth) |
| `src/agenda/*` | repos turno/bloqueo, `crearTurno.service.ts`, `turnos.routes.ts` | **Intacto** (pertenece a C-04) |
| `tests/crear_turno.test.ts` | 20 escenarios Vitest sobre SQLite real | **Intacto**; sigue verde |

## Contratos preservados (verificación por imports del test C-04)

`tests/crear_turno.test.ts` (sin editar) importa y ejercita estos símbolos; deben
mantener firma y semántica idénticas:

```ts
import { BloqueoRepository } from '../src/agenda/bloqueo.repository.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { applyMigration003, openDatabase } from '../src/shared/repository.js';
import type { PacienteId, ProfesionalId, SillonId } from '../src/shared/types.js';
```

- `createApp(db)` → `Express`, `GET /api/health` → `200 {"status":"ok"}`, monta `turnosRouter`.
- `openDatabase(path?)` → `DatabaseSync` con migraciones 001→003 aplicadas; `:memory:` por defecto.
- `applyMigration003(db)` → aplica la migración 003 (delegando en el runner).
- `BaseRepository<T>`, `UnitOfWork` (`BEGIN IMMEDIATE`), `AuditMixin`/`auditStamp`.
- `CrearTurnoError` con `status` (400/403/409), `eje`, ids opacos y `toBody()`; brand types.
- `turnosRouter(db)` → `Router` con `POST /api/turnos`.

Verificación: `npm run typecheck` + `npm test` verdes con la suite C-04 sin modificar.
