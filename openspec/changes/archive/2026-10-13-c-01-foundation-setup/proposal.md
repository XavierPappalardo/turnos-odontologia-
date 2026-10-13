# Proposal — c-01-foundation-setup

## Why

`C-01` es el primer change del roadmap (GATE 0, sin dependencias) y el cimiento del que dependen `C-02`, `C-03` y todo el MVP: sin él, los changes posteriores construyen sobre contratos solo declarados como `[Supuesto]`. El proyecto ya arrastra un scaffolding **parcial y no formalizado** de `backend/` dejado por `c-04-agenda-turnos-overlaps` (propuesto/aplicado/archivado antes de que C-01 existiera) y el frontend aún no existe. C-01 **formaliza y completa** ese cimiento —sin remodelarlo ni borrarlo— y aporta el scaffolding `frontend/` con el stack recién decidido (React + Vite + TypeScript).

## What Changes

**Backend — se absorbe y completa el scaffold existente (no se reescribe):**

- **Absorbido (existe, se documenta como contrato real):** layout `backend/` con `package.json` (express; devDeps typescript/vitest/supertest/@types; scripts `dev`/`build`/`test`/`typecheck`), `tsconfig.json` strict, `vitest.config.ts`, `.env.example` (sin secretos), `.gitignore`; `src/shared/` (`app.ts` factory `createApp(db)` + `GET /api/health`; `repository.ts` `BaseRepository`/`UnitOfWork`/`openDatabase`; `migrations.ts` 001–003; `types.ts` brand types; `errors.ts`; `auth.ts` stub); `src/agenda/` (turno/bloqueo repos, `crearTurno.service.ts`, `turnos.routes.ts`); `tests/crear_turno.test.ts`.
- **Completado (falta, se agrega):** `shared/` con **settings/config cargado de env** (sin defaults hardcodeados, sin secretos), **logger estructurado** (sin PHI ni payloads sensibles), **conexión de BD + runner/registro de migraciones** que formaliza la **migración base 001**, **excepciones tipadas + middleware centralizado de errores** (sin stack traces al cliente), **servidor de arranque/graceful shutdown**, scripts de dev y **CI mínimo**, además de runners de test backend.
- **Corrección de contratos:** los contratos que C-04 marcó `[Supuesto]` (migraciones base, `BaseRepository`/`UnitOfWork`/`AuditMixin`, health check, brand types, auth) pasan a ser **contratos reales documentados** de C-01.

**Frontend — scaffolding nuevo:**

- Estructura `frontend/` con **React + Vite + TypeScript** (decisión explícita de este change): `package.json` (scripts `dev`/`build`/`preview`/`test`/`typecheck`/`lint`), `vite.config.ts`, `tsconfig.json`, tooling de lint y test, estructura de componentes (`src/` con `main.tsx`/`App.tsx` y carpeta de componentes), y `.env.example` (solo `VITE_*` públicas, sin secretos).

**Tareas de cierre (APPLY-TIME, se registran en `tasks.md`; NO se ejecutan en esta propuesta):**

- Marcar en `CHANGES.md` **C-01 `[x]`** y **C-04 `[x]`** (corrección factual: C-04 ya está archivado).
- Reflejar la decisión de frontend React+Vite+TS en `AGENTS.md` + `CLAUDE.md` y en `knowledge-base/09-decisiones.md` (hoy declaran el frontend "No definido aún").

## Capabilities

### New Capabilities
- `platform/foundation`: contratos observables del cimiento del proyecto — health check, configuración por variables de entorno, bootstrap de BD + runner de migraciones (migración base 001), logging estructurado sin datos sensibles, manejo centralizado de errores tipados, scripts de desarrollo/CI y contratos de build/dev del frontend React+Vite+TS.

### Modified Capabilities
- (vacío — no hay specs previas de plataforma; `agenda/crear-turno` pertenece a C-04 y no cambia de requisitos en este change)

## Impact

- **Affected code**: `backend/` (se completa `src/shared/`, migración base, scripts, CI; se preserva `src/agenda/` intacto) y `frontend/` (nuevo scaffolding completo). No se modifica `src/agenda/` ni el spec `agenda/crear-turno`.
- **APIs**: contrato estable `GET /api/health` → `200 {status:'ok'}`; no se agregan endpoints de dominio en este change.
- **Dependencies**: ninguna (GATE 0). Habilita `C-02 core-models`. Formaliza los contratos que C-04 consumía como `[Supuesto]`.
- **Docs de cierre (apply-time)**: `CHANGES.md`, `AGENTS.md`, `CLAUDE.md`, `knowledge-base/09-decisiones.md`.
- **Restricciones duras**: R1/R12 fixtures ficticios; R2/R5 montos enteros centavos (N/A operativo aquí, el cimiento no maneja montos); R7 stack inamovible (frontend React+Vite+TS aprobado ahora); R8 acceso a datos vía `BaseRepository`+`UnitOfWork`; R10 TS estricto + brand types; R14 flujo propose→apply→archive; R15 scripts `tsc --noEmit` + `npm test`, nunca commitear secretos/`.env`/`.atl`.
