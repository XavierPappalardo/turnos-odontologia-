# Design — c-01-foundation-setup

## Context

Ver `proposal.md` (Why/What) y `specs/platform/foundation/spec.md` (contratos observables). El estado actual **no es greenfield**: existe un scaffold backend parcial y no formalizado dejado por el change ya archivado `c-04-agenda-turnos-overlaps`. Este diseño parte del inventario real observado en disco (read-only) y define cómo C-01 lo **absorbe y completa sin remodelarlo ni borrarlo**, más el scaffolding nuevo de `frontend/`.

**Inventario observado de `backend/` (se preserva; C-04 y su test dependen de ello):**

| Archivo | Rol observado | Acción C-01 |
|---|---|---|
| `package.json` | deps `express`; devDeps `typescript`, `vitest`, `supertest`, `@types/*`; scripts `dev` (`tsc --watch`), `build`, `test`, `typecheck`; `"type":"commonjs"` | Absorber; completar `dev` con servidor y agregar engine Node |
| `tsconfig.json` | strict, `noImplicitAny`, `exactOptionalPropertyTypes`, target ES2022 | Absorber |
| `vitest.config.ts` | env node, `tests/**/*.test.ts` | Absorber; reutilizar en workspace con frontend |
| `.env.example` | `PORT=3000` sin secretos | Absorber; ampliar variables |
| `.gitignore` | ignora `node_modules/`, `dist/`, `.env`, `*.db*`, `coverage/` | Absorber |
| `src/shared/app.ts` | factory `createApp(db)` + `GET /api/health` → `{status:'ok'}`; monta `turnosRouter` | Absorber contrato; enchufar logger + error middleware |
| `src/shared/repository.ts` | `BaseRepository<T>`, `UnitOfWork` (`BEGIN IMMEDIATE`), `openDatabase` (001→003), `applyMigration003`, `AuditMixin` (`auditStamp`) | Preservar API/export; envolver con runner formal |
| `src/shared/migrations.ts` | constantes SQL `MIGRATION_001_CORE`, `_002_AUTH`, `_003_TURNO_BLOQUEO` | Preservar; formalizar 001 como base registrada |
| `src/shared/types.ts` | brand types (`TurnoId`≠`ProfesionalId`≠…) + estados | Absorber (R10) |
| `src/shared/errors.ts` | `CrearTurnoError` tipada con `toBody()` sin PHI; `EjeConflicto` | Preservar; generalizar bajo `AppError` |
| `src/shared/auth.ts` | stub RBAC (`x-role`) `[Supuesto]` C-03 | Preservar (no es alcance C-01 reimplementar auth) |
| `src/agenda/*` | repos turno/bloqueo, `crearTurno.service.ts`, `turnos.routes.ts` | **Intactos** (pertenecen a C-04) |
| `tests/crear_turno.test.ts` | 12 escenarios Vitest sobre SQLite real | **Intacto**; debe seguir verde |

Constraints transversales (R7 stack TS+Node/Express+SQLite+Vitest; R8 datos vía `BaseRepository`+`UnitOfWork`; R10 TS estricto + brand types; R11/R12 tests con SQLite real; R3/R15 sin PHI ni secretos en logs/repo). KB-08 §1/§2 fijan monolito modular y estructura; KB-08 §5 dice que el README futuro será la fuente autoritativa de cómo correr tests.

## Goals / Non-Goals

**Goals:**
- Convertir el scaffold `[Supuesto]` de C-04 en contratos reales de fundación (config, logger, runner de migraciones con base 001, errores centralizados, health) sin romper `src/agenda/` ni sus tests.
- Dejar `backend/` y `frontend/` con scripts de dev/verificación/CI reproducibles.
- Scaffold `frontend/` React + Vite + TypeScript con tooling mínimo (lint/test/typecheck) y `.env.example`.

**Non-Goals:**
- No se implementan modelos de dominio (`C-02`), auth JWT/RBAC real (`C-03`), endpoints de dominio, ni UI de negocio.
- No se modifica `src/agenda/`, `tests/crear_turno.test.ts`, ni el spec `agenda/crear-turno`.
- No se agregan ORMs, microservicios, app móvil ni integraciones externas (R13).
- No se ejecutan las tareas de cierre documental (CHANGES.md/AGENTS.md/CLAUDE.md/KB-09): se registran en `tasks.md` para APPLY.

## Decisions

### D1. Estrategia de absorción del scaffold C-04 (preservar > reescribir)

Se adopta la regla "**preservar y completar, nunca remodelar**": las firmas exportadas que C-04 consume (`createApp`, `openDatabase`, `applyMigration003`, `BaseRepository`, `UnitOfWork`, `CrearTurnoError`, brand types, `turnosRouter`) se mantienen con la misma semántica. Las piezas nuevas (config, logger, runner formal, error middleware) se **añaden alrededor**.
- **Alternativa descartada:** reescribir `backend/` desde cero según KB-08. Se descarta porque rompería `tests/crear_turno.test.ts` y los contratos que C-04 documentó como `[Supuesto]`, violando R14 (specs como fuente de verdad) y el pedido explícito de no remodelar.

### D2. Configuración/settings desde entorno, sin defaults silenciosos

Un módulo `shared/config.ts` lee `process.env` una sola vez y expone un objeto tipado. Variables backend mínimas: `PORT`, `DATABASE_PATH` (o `":memory:"`), `NODE_ENV`. Si una variable requerida falta, lanza error descriptivo (fail-fast) en el bootstrap. `.env.example` documenta solo nombres + valores de ejemplo no secretos. Frontend usa solo `VITE_*` (p. ej. `VITE_API_BASE_URL`) por exposición al navegador.
- **Alternativa descartada:** usar defaults hardcodeados (`PORT ?? 3000`) repartidos en código. Se descarta por R15 (nunca hardcodear) y para que la falta de config falle ruidosamente.

### D3. Logger estructurado con redacción de sensibles

`shared/logger.ts` emite una línea JSON por evento (`level`, `timestamp`, `msg`, campos de contexto) a stdout/stderr. Regla dura: **nunca** loguear PHI (nombres, DNI, historia clínica, teléfonos), secretos ni payloads completos; la identificación de recursos usa solo ids opacos (UUID), como ya hace `crearTurno.service.ts` (`console.log('turno creado id=...')`). El logger es inyectable para testear la salida sin estado global.
- **Alternativa descartada:** mantener `console.*` disperso. Se descarta porque no es parseable ni auditable, y no permite garantizar (R3) que no se filtre PHI.

### D4. Runner de migraciones formalizando la base 001

Se introduce un **registro ordenado** de migraciones (`[{id:'001', sql:MIGRATION_001_CORE}, {id:'002',...}, {id:'003',...}]`) y una función `runMigrations(db)` que aplica, de forma idempotente, las migraciones pendientes dentro de una transacción, con `PRAGMA foreign_keys = ON` y `journal_mode = WAL`. `openDatabase(path)` se conserva como azúcar que delega en `runMigrations`, preservando el comportamiento 001→003 que el test de C-04 ya usa. La **migración base 001** (tablas `profesional`, `sillon`, `paciente`, `prestacion`) queda así formalizada como contrato de fundación. Idempotencia verificada por `CREATE TABLE IF NOT EXISTS` + tabla de control `schema_migrations`.
- **Alternativa descartada:** runner con archivos `.sql` externos y carpeta `migrations/`. Se descarta por simplicidad y porque el scaffold ya centraliza SQL en `migrations.ts`; migrar a archivos es un refactor no pedido.

### D5. Excepciones tipadas + middleware centralizado de errores

Se agrega una jerarquía `AppError` (base) con `status`, `code` y `toBody()`; `CrearTurnoError` pasa a extenderla **manteniendo su forma actual** (status 400/403/409, `eje`, ids opacos). Un `errorHandler` Express (4 args) es el único punto de traducción a JSON: `AppError` → su `status`; no controlado → `500 {"error":"interno"}` **sin stack, rutas, SQL ni PHI**. Los routers existentes pueden conservar su try/catch de C-04; el middleware cubre lo no capturado.
- **Alternativa descartada:** dejar el `try/catch` por ruta. Se descarta por R-vitest/nodejs-backend-patterns (middleware centralizado) y para evitar fugas de stack traces.

### D6. Completar `shared/`: bootstrap del servidor y graceful shutdown

Se agrega `shared/server.ts` con `listen` sobre `PORT` y cierre ordenado (`SIGINT`/`SIGTERM` → cerrar servidor HTTP → cerrar `DatabaseSync`). `createApp(db)` no cambia de firma (testeable con supertest sin `listen`, como ya se usa). Health `GET /api/health` se mantiene estable.

### D7. Scripts de dev/CI y runners de test

Backend: preservar `typecheck`/`test`/`build`; ajustar `dev` para levantar el servidor con watch (no solo `tsc --watch`). Frontend: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`. CI mínimo (GitHub Actions) con dos jobs (backend, frontend): `npm ci` → `npm run typecheck` → `npm test`. Vitest en frontend usa el mismo runner (config compartida vía `defineConfig`); si se usa workspace multiproyecto se hace con `projects`, sin estado global mutable (fixtures vía `test.extend`).

### D8. Scaffolding `frontend/` con React + Vite + TypeScript

Estructura: `frontend/` con `package.json` (`"type":"module"`, deps `react`/`react-dom`, devDeps `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/*`, `eslint`), `vite.config.ts`, `tsconfig.json` (+ `tsconfig.node.json`), `index.html`, `src/main.tsx`, `src/App.tsx`, `src/components/` (placeholder de estructura), `src/vite-env.d.ts` (tipar `ImportMetaEnv` con `VITE_*`), `.env.example` (`VITE_API_BASE_URL`), `.gitignore`. Config estricta TS y lint sin `any` injustificado (R10).
- **Alternativa descartada:** Next.js / Vue / Svelte. Se descartan por instrucción explícita del usuario; el stack frontend aprobado es React + Vite + TypeScript (extiende R7 de forma explícita, no lo rompe).

### D9. Cierre documental (APPLY-time, solo registrado)

En `tasks.md` como tareas de cierre: (a) marcar `C-01 [x]` y `C-04 [x]` en `CHANGES.md` (corrección factual: C-04 ya está archivado); (b) reflejar "frontend React + Vite + TypeScript" en `AGENTS.md`, `CLAUDE.md` y `knowledge-base/09-decisiones.md` (hoy dicen "No definido aún"). No se ejecutan en esta propuesta.

## Risks / Trade-offs

- [Riesgo] Tocar `shared/repository.ts`/`errors.ts` rompe `tests/crear_turno.test.ts` (C-04) → **Mitigación**: D1/D4/D5 preservan firmas y semántica; el criterio de done incluye correr esa suite en verde sin editarla.
- [Riesgo] `node:sqlite` (`DatabaseSync`) es API en evolución y exige Node reciente → **Mitigación**: fijar `engines.node` (≥22.5) y documentarlo; el runner delega en el mismo motor ya usado por C-04.
- [Riesgo] Fuga de PHI/secretos por logs o `.env` (R3/R15) → **Mitigación**: logger con redacción + `.env.example` sin valores reales + `.gitignore` que ya excluye `.env`; revisión de logs en tests.
- [Trade-off] Un único capability `platform/foundation` mezcla contratos backend y frontend → aceptable: es un change de cimiento; dividirlo en `platform/foundation` + `frontend/*` duplicaría propósito. Se documenta la decisión.
- [Riesgo] El CI mínimo puede no existir como plataforma en el repo → **Mitigación**: si no hay remoto GitHub, el "CI mínimo" puede materializarse como script `npm run ci` invocado por cualquier runner; se decide en APPLY sin cambiar specs.

## Migration Plan

1. Añadir config/logger/runner/middleware en `backend/src/shared/` **sin** alterar firmas existentes; verificar `npx tsc --noEmit` y `npx vitest run` (incluye `crear_turno.test.ts` intacto).
2. Ampliar `.env.example`, `package.json` (scripts/engine) y agregar CI.
3. Scaffold `frontend/` y verificar `typecheck`/`test`/`build`.
4. Actualizar README (opcional) con comandos autoritativos (KB-08 §5).
5. Rollback: los cambios son aditivos; revertir los archivos nuevos no afecta `src/agenda/` ni el spec archivado de C-04.

## Open Questions

- Plataforma concreta del "CI mínimo" (GitHub Actions vs script `npm run ci`) y gestor de paquetes del frontend (npm por defecto) se confirman en APPLY según lo disponible; no cambian specs, enfoque ni tareas.
- Versión mínima exacta de Node para `node:sqlite` se fija en APPLY contra el entorno; no altera el diseño.
