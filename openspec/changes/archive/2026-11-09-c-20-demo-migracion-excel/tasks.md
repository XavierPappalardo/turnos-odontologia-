# Tasks

## 1. Contrato y utilidades de importación (backend)

- [x] 1.1 Definir módulo `backend/src/utilidades/demo-migracion-excel/` (tipos de entidad soportada, formatos, mapeo, resultado de preview/confirmación, errores tipados por fila) y, si aplica, configuración/validaciones de límites seguros; verificar con `npm run typecheck` y tests unitarios de normalización/contrato. — OK: `tipos.ts`/`parser.ts`/`service.ts`/`routes.ts`, límites `MAX_FILAS/MAX_CONTENIDO`; `npm run typecheck` OK; `demo_migracion_parser.test.ts` verde.
- [x] 1.2 Implementar parseo tabular (CSV base; Excel si el alcance lo requiere con dependencia mínima) y normalización a filas por entidad sin loguear contenido sensible; verificar con tests Vitest Dado/Cuando/Entonces (fixtures ficticias) para CSV válido/inválido y formato no soportado. — OK: CSV nativo + mapeo; Excel via `xlsx` (dep agregada, lectura base64) con rechazo seguro si no disponible; sin log de contenido; tests parser CSV válido/inválido/formato no soportado/mapeo.

## 2. Demo instantánea y lógica de validación/importación

- [x] 2.1 Implementar carga de demo instantánea con datos ficticios e idempotencia/control seguro (reutilizando/extending seed ficticio existente cuando corresponda), restringida a rol autorizado; verificar con tests SQLite real que no duplica indebidamente y no usa datos reales. — OK: `service.cargarDemo()` reutiliza `seedMinimo()` (idempotente); endpoint admin/RBAC; test SQLite real idempotencia/ficticio.
- [x] 2.2 Implementar preview sin persistencia para `pacientes`, `profesionales` y `turnos` (mapeo, validaciones por fila, reporte de errores tipados, resumen/muestras seguras); verificar con tests que preview no escribe en DB y reporta filas válidas/inválidas. — OK: `preview()` sin writes, reparsea/valida, errores tipados por fila (sin volcar valores sensibles), muestras seguras de campos; tests preview no persiste + válidas/inválidas/referencias turno.
- [x] 2.3 Implementar confirmación con revalidación y persistencia controlada/transaccional de filas aceptadas; para turnos validar referencias/integridad y reglas aplicables (incl. estados activos compatibles con R9/anti-solapamiento según diseño), rechazando filas inválidas sin corromper datos previos; verificar con tests SQLite real de importación válida/inválida y reporte final. — OK: `confirmar()` revalida, UoW transaccional, fallo => rollback seguro; turnos activos validan refs/fin>inicio/solape prof+sillón+`existeBloqueoAplicable`+solape en lote (R9-compatible); históricos no ocupan agenda; tests válida/inválida/solape activo/histórico.

## 3. API admin y UI mínima

- [x] 3.1 Agregar endpoints admin (`/api/utilidades/demo`, preview, confirmar) con `requireAuth` + RBAC `administracion`, manejo tipado de errores y respuestas/logs sin PHI ni contenido importado sensible; montar en `backend/src/shared/app.ts`; verificar con tests de integración (supertest, SQLite real) autorización (401/403) y flujos preview/confirm/demo seguros. — OK: `demoMigracionRouter` montado en `/api`; 401/403/201/200 y rechazo formato no soportado sin volcar contenido sensible; `demo_migracion_routes.test.ts` verde.
- [x] 3.2 Agregar UI mínima en `frontend/src/` para carga de archivo, selección de entidad/mapeo básico, preview, lista de errores y confirmación/carga demo (integración mínima en `App.tsx` acorde al estado actual del frontend); verificar con `npm run typecheck`/`npm test` (y `npm run lint` si aplica) en `frontend/` y comportamiento manual/documentado. — OK: `frontend/src/utilidades/MigracionDemo.tsx` + toggle en `App.tsx` (token admin, entidad/formato, FileReader text/base64, mapeo JSON opcional, preview/confirm/demo, resultados/errores). `frontend` `tsc -b` y `vitest` (3 files/6 tests) verdes; `oxlint` sin errores (ver abajo). Auth UX mínima (token manual) documentada en UI.

## 4. Verificación final

- [x] 4.1 Ejecutar verificación final: `cd backend && npm run typecheck && npm test`; `cd frontend && npm run typecheck && npm test` (y lint si corresponde) en verde; verificar fixtures ficticias, sin credenciales/`.env` reales, sin dependencias/llamadas externas reales innecesarias, sin PHI/contenido importado sensible en logs/respuestas. — OK (2026-11-09): backend `tsc --noEmit` limpio, `vitest` **88 files / 1109 tests passed** (incl. C-20 20 tests). Frontend `tsc -b` limpio, `vitest` **3 files / 6 tests passed**; `oxlint` sin errores nuevos (2 warnings preexistentes `PortalPaciente.tsx:64,99`, ajenos). Sin `console`/`logger`/PHI en respuestas del módulo nuevo; errores tipados sin volcar contenido importado sensible; fixtures ficticias; sin credenciales hardcodeadas; sin llamadas externas reales (Excel dep local `xlsx`).

## Workflow follow-up

- Revisar artefactos de `c-20-demo-migracion-excel` y, cuando el usuario lo pida, iniciar `/opsx:apply` en una nueva solicitud (governance BAJO/R16).
- Tras implementación y verificación, archivar con `/opsx:archive c-20-demo-migracion-excel` y actualizar `CHANGES.md` según el flujo del proyecto.
- Antes de commit/push: cumplir R15 (`tsc --noEmit` + tests, conventional commits, sin secretos).
