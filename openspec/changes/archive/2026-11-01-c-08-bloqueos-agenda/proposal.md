# Proposal — C-08 bloqueos-agenda

## Why

La agenda ya rechaza turnos sobre bloqueos (`agenda/crear-turno`), pero la tabla `bloqueo` no tiene forma de administrarse: hoy solo se puede poblar por SQL manual. Sin CRUD, recepción no puede cargar vacaciones, cursos, feriados ni mantenimiento de sillón (RN-04, F-01), y un bloqueo cargado por error no puede liberarse sin tocar la base.

## What Changes

- Nuevo CRUD interno de bloqueos: `POST /api/bloqueos`, `GET /api/bloqueos` (filtros por profesional, sillón y rango de fechas), `PUT /api/bloqueos/:id`, `DELETE /api/bloqueos/:id`.
- Alta/edición de un bloqueo que intersecta turnos activos (`reservado`, `confirmado`, `presente`) se rechaza con `409`, `eje: "bloqueo"` y la lista de `turno_id` en conflicto (solo ids opacos, sin PHI); el bloqueo no se crea ni se modifica.
- `DELETE` es soft-delete (`deleted_at`), nunca borrado físico.
- Toda consulta de aplicabilidad/solape pasa a filtrar `deleted_at IS NULL`: `existeBloqueoAplicable`, `existeSolapeProfesional`, `existeSolapeSillon`, `contarActivosEnHueco`. Un bloqueo borrado deja de bloquear reservas.
- `BaseRepository` gana `update(id, patch)` y `softDelete(id)`; los listados concretos viven en `BloqueoRepository`.
- RBAC: `recepcion` y `administracion` gestionan y leen; `profesional` recibe `403` en `POST`, `GET`, `PUT` y `DELETE`.
- Sin migración nueva: la tabla `bloqueo` (003) ya tiene `deleted_at` (004) e índice `idx_bloqueo_aplicabilidad`.
- **BREAKING** (comportamiento): un bloqueo soft-deleted deja de rechazar turnos; hoy la consulta lo ignora y bloquea igual.

## Capabilities

### New Capabilities

- `agenda/bloqueos`: CRUD de bloqueos de agenda con validación de intersección contra turnos activos, globabilidad profesional/sillón y RBAC de gestión/lectura.

### Modified Capabilities

- `agenda/crear-turno`: el requisito "Validación contra bloqueos" incorpora explícitamente que solo aplican bloqueos con `deleted_at IS NULL` (los soft-deleted no bloquean).

## Impact

- `backend/src/shared/repository.ts` — `update`/`softDelete` genéricos en `BaseRepository`.
- `backend/src/agenda/bloqueo.repository.ts` — `BloqueoRow.deleted_at`, filtros, listado y consultas de intersección.
- `backend/src/agenda/turno.repository.ts` — `deleted_at IS NULL` en las tres consultas de solape/conteo.
- `backend/src/agenda/crearTurno.service.ts` — sin cambios de flujo; hereda el filtro vía repositorio.
- Nuevos: `backend/src/agenda/bloqueo.service.ts`, `backend/src/agenda/bloqueos.routes.ts`.
- `backend/src/shared/auth.ts` — permisos de gestión/lectura de bloqueos.
- `backend/src/shared/errors.ts` — error tipado de bloqueos (`409` con `turno_id`s).
- `backend/src/shared/app.ts` — montaje del router en `/api`.
- Tests: `backend/tests/bloqueos.test.ts`, `backend/tests/bloqueo_softdelete.test.ts`.
- Sin dependencias externas nuevas; sin migración; sin cambios en la máquina de estados del turno.
