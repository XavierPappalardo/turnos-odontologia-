# Tasks — C-08 bloqueos-agenda

Cada grupo sigue el ciclo TDD RED → GREEN → TRIANGULATE → REFACTOR. Los tests usan SQLite real en memoria (`openDatabase(':memory:')`), fixtures ficticios (R1/R12) y nombres `Dado/Cuando/Entonces` (R11). El comando de verificación transversal es `npm test` (Vitest) y `npm run typecheck` (`tsc --noEmit`).

## 1. Filtro `deleted_at` en las consultas de agenda

- [x] 1.1 **(RED)** En `backend/tests/bloqueo_softdelete.test.ts`, escribir escenarios que inserten un bloqueo vigente y otro con `deleted_at` no nulo y verifiquen que `existeBloqueoAplicable` solo detecta el vigente; repetir para `existeSolapeProfesional`, `existeSolapeSillon` y `contarActivosEnHueco` con turnos soft-deleted. Verificación: los escenarios nuevos fallan con el código actual (`npx vitest run tests/bloqueo_softdelete.test.ts`).
- [x] 1.2 **(GREEN)** Agregar `AND deleted_at IS NULL` a `existeBloqueoAplicable` (`backend/src/agenda/bloqueo.repository.ts`) y a `existeSolapeProfesional`, `existeSolapeSillon` y `contarActivosEnHueco` (`backend/src/agenda/turno.repository.ts`). Verificación: los escenarios de 1.1 pasan.
- [x] 1.3 **(TRIANGULATE)** En el mismo archivo, agregar el escenario de servicio: bloqueo vigente hace fallar `crearTurno` con `409 eje=bloqueo`, se marca `deleted_at` por SQL directo y el mismo `crearTurno` responde `201`. Verificación: escenario verde.
- [x] 1.4 **(REFACTOR)** Extraer el fragmento `deleted_at IS NULL` a una constante local por repositorio y confirmar que `npx vitest run tests/crear_turno.test.ts tests/reserva_online.test.ts tests/bloqueo_softdelete.test.ts` sigue verde.

## 2. Primitivas `update` y `softDelete` en `BaseRepository`

- [x] 2.1 **(RED)** En `backend/tests/bloqueo_softdelete.test.ts`, agregar escenarios con una instancia concreta (`new BloqueoRepository(db)`): `softDelete(id)` devuelve `true` y setea `deleted_at`/`updated_at`; el segundo `softDelete(id)` devuelve `false` y conserva el `deleted_at` original; `update(id, { motivo })` devuelve `true`, cambia `motivo` y refresca `updated_at`; `update` con id inexistente devuelve `false`. Verificación: los escenarios fallan por métodos ausentes.
- [x] 2.2 **(GREEN)** Implementar `update(id, patch)` y `softDelete(id)` en `backend/src/shared/repository.ts` según design D1 (`updated_at` siempre, `WHERE id = ? AND deleted_at IS NULL`, retorno `changes === 1`). Verificación: escenarios de 2.1 verdes.
- [x] 2.3 **(TRIANGULATE)** Agregar el escenario de patch vacío (solo refresca `updated_at`, devuelve `true`) y el de nombre de columna inválido (lanza `Error` antes de emitir SQL). Verificación: ambos escenarios verdes.
- [x] 2.4 **(REFACTOR)** Extraer el validador de identificadores a una función privada del módulo y confirmar `npm run typecheck` sin `any` (R10).

## 3. `BloqueoRepository`: escritura, listado e intersección

- [x] 3.1 **(RED)** En `backend/tests/bloqueos.test.ts`, escribir escenarios de repositorio: `crear` persiste un bloqueo y `buscarVigente` lo recupera; `buscarVigente` devuelve `undefined` para un id soft-deleted; `listar` filtra por `profesional_id`, por `sillon_id` y por rango `[desde, hasta)`; `turnosActivosEnInterseccion` devuelve los `turno_id` correctos para bloqueo por profesional, por sillón y global (ambos NULL), y ninguno cuando los turnos están `cancelado`/`ausente`/`atendido` o soft-deleted. Verificación: los escenarios fallan.
- [x] 3.2 **(GREEN)** Ampliar `BloqueoRow` con `deleted_at` e implementar `crear`, `actualizar`, `bajaLogica`, `buscarVigente`, `listar` y `turnosActivosEnInterseccion` en `backend/src/agenda/bloqueo.repository.ts` (todo el SQL en el repositorio, R8). Verificación: escenarios de 3.1 verdes.
- [x] 3.3 **(TRIANGULATE)** Agregar escenarios de combinaciones de globabilidad (`profesional` con `sillon_id` NULL, `sillon` con `profesional_id` NULL, ambos con valor) y de rango contiguo (`fin == desde`) que no debe matchear. Verificación: escenarios verdes.
- [x] 3.4 **(REFACTOR)** Deduplicar los fragmentos SQL de intersección dentro de `BloqueoRepository` y confirmar que la suite de `bloqueos.test.ts` sigue verde.

## 4. Errores tipados, RBAC y servicio de bloqueos

- [x] 4.1 **(RED)** En `backend/tests/bloqueos.test.ts`, agregar escenarios de `BloqueoError.toBody()` (`validacion` incluye `detalle`; `conflicto` incluye `eje` y `turno_ids`; `not_found` solo `error`) y de `puedeGestionarBloqueos`/`puedeLeerBloqueos` para los tres roles. Verificación: los escenarios fallan.
- [x] 4.2 **(GREEN)** Implementar `BloqueoError` en `backend/src/shared/errors.ts` y `ROLES_BLOQUEOS`, `puedeGestionarBloqueos`, `puedeLeerBloqueos` en `backend/src/shared/auth.ts`. Verificación: escenarios de 4.1 verdes.
- [x] 4.3 **(RED)** En `backend/tests/bloqueos.test.ts`, escribir escenarios de servicio: `crearBloqueo` responde con el bloqueo creado; `fin <= inicio`, fecha sin zona, FK inexistente/inactiva y `profesional` sin permiso lanzan `400`/`403`; `crearBloqueo` sobre turno `confirmado` lanza `409` con `turnoIds` y no persiste; `actualizarBloqueo` sobre turno activo lanza `409` y deja el bloqueo original intacto; `actualizarBloqueo`/`eliminarBloqueo` con id inexistente lanza `404`; `listarBloqueos` devuelve todos los bloqueos vigentes sin lógica por rol. Verificación: los escenarios fallan.
- [x] 4.4 **(GREEN)** Implementar `backend/src/agenda/bloqueo.service.ts` con `crearBloqueo`, `listarBloqueos`, `actualizarBloqueo` y `eliminarBloqueo`, escrituras dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`, R9) y reutilización de `normalizarUtc` de `crearTurno.service.ts`. Verificación: escenarios de 4.3 verdes.
- [x] 4.5 **(TRIANGULATE)** Agregar escenarios de `motivo` nulo, bloqueo global (ambos NULL) que intersecta un turno de cualquier profesional y edición válida que no intersecta turnos. Verificación: escenarios verdes.
- [x] 4.6 **(REFACTOR)** Unificar la verificación de FK activa en un helper privado del servicio y confirmar `npm run typecheck`.

## 5. Rutas HTTP y montaje en `/api`

- [x] 5.1 **(RED)** En `backend/tests/bloqueos.test.ts`, agregar escenarios con `supertest` sobre `createApp`: `POST /api/bloqueos` responde `201` con campos snake_case; `GET /api/bloqueos` responde `200 { bloqueos: [...] }` con filtros `profesional_id`, `sillon_id`, `desde` y `hasta`; `PUT /api/bloqueos/:id` responde `200`; `DELETE /api/bloqueos/:id` responde `204` sin cuerpo; `profesional` recibe `403` en los cuatro métodos (`GET` incluido) y sin token `401`; `404` en `PUT`/`DELETE` inexistente; `409` con `turno_ids` y sin PHI. Verificación: los escenarios fallan (ruta no montada).
- [x] 5.2 **(GREEN)** Implementar `backend/src/agenda/bloqueos.routes.ts` (auth + `requireRoles(...ROLES_BLOQUEOS)` en los cuatro métodos, parseo de body/query, mapeo snake_case) y montarlo en `backend/src/shared/app.ts` con `app.use('/api', bloqueosRouter(db, config))`. Verificación: escenarios de 5.1 verdes.
- [x] 5.3 **(TRIANGULATE)** Agregar escenarios de query inválida (`desde` sin zona, `hasta` inválido → `400`) y de token ausente (→ `401`). Verificación: escenarios verdes.
- [x] 5.4 **(REFACTOR)** Extraer el mapeo `BloqueoRow → JSON` a una función local y confirmar que `npx vitest run tests/bloqueos.test.ts` sigue verde.

## 6. Integración end-to-end de baja lógica

- [x] 6.1 **(RED)** En `backend/tests/bloqueo_softdelete.test.ts`, agregar el flujo HTTP completo: `POST /api/bloqueos` → `POST /api/turnos` intersectado responde `409 eje=bloqueo` → `DELETE /api/bloqueos/:id` responde `204` → el mismo `POST /api/turnos` responde `201`; `GET /api/bloqueos` ya no lista el bloqueo; segundo `DELETE` responde `404`. Verificación: el escenario falla si algún filtro o ruta quedó incompleto.
- [x] 6.2 **(GREEN)** Corregir cualquier brecha de integración detectada (sin cambiar comportamiento de `agenda/crear-turno` más allá del filtro `deleted_at`). Verificación: escenario de 6.1 verde.
- [x] 6.3 **(TRIANGULATE)** Repetir el flujo con un bloqueo global (ambos NULL) para confirmar que su baja libera a todos los profesionales y sillones. Verificación: escenario verde.
- [x] 6.4 **(REFACTOR)** Revisar duplicación de fixtures entre `bloqueos.test.ts` y `bloqueo_softdelete.test.ts`; si se extrae un helper, confirmar ambas suites verdes.

## 7. Verificación y cierre del change

- [x] 7.1 Ejecutar `npm run typecheck` en `backend/` y confirmar cero errores sin `any` nuevos (R10). Verificación: comando exitoso.
- [x] 7.2 Ejecutar `npm test` en `backend/` y confirmar toda la suite verde, incluidos `crear_turno.test.ts`, `reserva_online.test.ts` y los tests nuevos (R11). Verificación: comando exitoso.
- [x] 7.3 Auditar las reglas duras del change: R1/R12 (fixtures ficticios), R3 (sin PHI en errores/logs), R8 (SQL solo en repositorios), R9 (`BEGIN IMMEDIATE` en create/update), R5/R6 (N/A, sin montos). Verificación: revisión de `git diff` sin hallazgos.
- [x] 7.4 Marcar `[C-08]` como `[x]` en `CHANGES.md` y actualizar la descripción si el alcance entregado difiere. Verificación: línea de estado actualizada.

## Workflow follow-up

- Solicitar la revisión de gobernanza MEDIUM de C-08 antes de archivar.
- Archivar el change con `/opsx:archive c-08-bloqueos-agenda` y verificar que `openspec/specs/agenda/bloqueos/spec.md` y el delta de `agenda/crear-turno` quedaron aplicados.
