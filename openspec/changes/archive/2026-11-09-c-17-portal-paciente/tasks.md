# Tasks

## 1. Configuración y persistencia de acceso portal

- [x] 1.1 Extender `backend/src/shared/config.ts` y validación con bloque `portalPaciente` (TTL/expiración de token, límites de rate, flags seguros sin secretos reales) y actualizar fixtures/helpers de `AppConfig` afectados; verificar con `npm run typecheck` y tests de config relacionados en verde. `PortalPacienteConfig` + defaults/loadConfig agregados; `agenda-fixtures` y 12 tests con `AppConfig` literales actualizados; `npm run typecheck` OK.
- [x] 1.2 Agregar migración incremental (siguiente ID disponible, esperado `015` si `014` ya existe) en `backend/src/shared/migrations.ts` para acceso portal (token hasheado, `paciente_id`, expiración, revocación/estado mínimo no-PHI, timestamps/índices) y registrarla en `MIGRATIONS`; verificar con test de migración que aplica idempotentemente y el esquema esperado existe sobre SQLite real.

## 2. Dominio de acceso y consultas acotadas por paciente

- [x] 2.1 Implementar repositorio/servicio de acceso portal (R8/UoW cuando corresponda) para emitir/validar/revocar/expirar tokens opacos hasheados asociados a un único paciente; verificar con tests Vitest Dado/Cuando/Entonces (SQLite real) que tokens válidos resuelven contexto paciente, inválidos/expirados/revocados fallan con errores tipados sin PHI y nunca se persiste/loguea el token en claro. `backend/src/portal/portalAcceso.{repository,service}.ts` + `tests/portal_acceso.test.ts` (6) verdes.
- [x] 2.2 Implementar consultas de portal acotadas por `paciente_id` para "mis turnos" y "mis presupuestos" (DTOs seguros, read-only), incluyendo caso vacío; verificar con tests que solo retornan recursos del paciente autenticado por token y que mutaciones de presupuesto desde portal no existen/no aplican (rechazo o ausencia de endpoint de escritura). `backend/src/portal/portalConsulta.repository.ts` + `tests/portal_consultas.test.ts` (5) verdes; DTOs sin nombre/PHI clínica.

## 3. Acciones de autogestión sobre turnos propios

- [x] 3.1 Implementar endpoints/servicio de portal para confirmar, cancelar y reprogramar turnos propios, validando pertenencia del turno al `paciente_id` del token antes de delegar a la lógica/transiciones existentes; verificar con tests Dado/Cuando/Entonces que transiciones válidas actualizan estado, cancelación fuera de anticipación/regla rechaza, y acciones sobre turnos ajenos rechazan sin filtrar PHI. `backend/src/portal/portalAccionTurno.service.ts` + `tests/portal_acciones.test.ts` (5) verdes.
- [x] 3.2 Asegurar que reprogramación desde portal reutilice validaciones vigentes de disponibilidad/anti-solapamiento/bloqueos (R9/RN-01/RN-02/RN-04/RN-06 según aplique) con semántica transaccional segura; verificar con tests SQLite real que conflictos no persisten cambios parciales. Cubierto por `portalAccionTurno` (UnitOfWork + repos solape/bloqueo + `normalizarUtc`) y test de conflicto sin cambio parcial.

## 4. API portal, sección documentos y hardening

- [x] 4.1 Agregar router de portal (namespace público/portal definido en implementación, p. ej. bajo `/api/public` o `/api/portal`) montado en `backend/src/shared/app.ts`, con middleware de token portal, rate limiting, `errorHandler` y respuestas/logs sin PHI; verificar con tests de integración (supertest) autenticación por token, scoping, errores seguros y límite de tasa. `backend/src/portal/portal.routes.ts` montado en `app.ts` (`/api/public/portal/*`), `requirePortal` + rate limit + rechazo mutaciones presupuesto; `backend tsc --noEmit` OK, `tests/portal_routes.test.ts` (8) verdes.
- [x] 4.2 Implementar sección "documentos" con comportamiento MVP seguro (lista vacía o referencias explícitamente disponibles/publicables si existen en alcance, sin nuevo storage documental ni exposición clínica); verificar con tests/API que retorna estado seguro sin PHI ni rutas internas sensibles. `GET /api/public/portal/documentos` retorna `{ documentos: [] }` sin PHI/rutas internas; cubierto por `tests/portal_routes.test.ts`.

## 5. Frontend portal responsive y verificación final

- [x] 5.1 Implementar en `frontend/` (React+Vite+TS existente) UI básica responsive para acceso por link/token y secciones mis turnos, mis presupuestos, documentos, más acciones confirmar/cancelar/reprogramar con manejo de errores seguros; verificar con tests frontend existentes (Vitest/RTL o equivalente del proyecto) y/o verificación manual documentada que los flujos principales renderizan y consumen la API portal. `frontend/src/portal/{api,PortalPaciente,portal.css}` + integración en `App.tsx`; token leído de fragment/query (prioridad hash), limpiado de URL sin loguear; `frontend/src/portal/PortalPaciente.test.tsx` (4) + `App.test.tsx` (1) verdes; `npm run typecheck` OK.
- [x] 5.2 Ejecutar verificación final acotada al change: `npm run typecheck` y `npm test` en `backend/` y checks/tests disponibles en `frontend/` en verde; verificar por inspección/tests que fixtures son ficticias, sin credenciales/`.env` reales y sin PHI en logs/respuestas/URLs sensibles del portal. Backend: `tsc --noEmit` OK, `vitest run` **79 files / 1049 tests passed**. Frontend (deps instaladas localmente, `node_modules` no versionado): `tsc -b` OK, `vitest run` **2 files / 5 tests passed**. Fixtures ficticias (IDs/nombres ficticios), sin credenciales/`.env` reales; portal no expone PHI/token en respuestas/logs y limpia token de URL.

## Workflow follow-up

- Revisar los artefactos de `c-17-portal-paciente` y, cuando el usuario lo pida, iniciar `/opsx:apply` en una nueva solicitud (este cambio es MEDIO por R16).
- Tras implementación y verificación, archivar con `/opsx:archive c-17-portal-paciente` y actualizar `CHANGES.md` según el flujo del proyecto.
- Antes de commit/push: cumplir R15 (`tsc --noEmit` + tests, conventional commits, sin secretos).
