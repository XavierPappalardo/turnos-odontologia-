# Tasks

## 1. Configuración y persistencia

- [x] 1.1 Extender `backend/src/shared/config.ts` con bloque validado `recuperacionCobranza` (habilitación, umbral/ventana de inactividad, ventanas/frecuencias/límites de contacto para recuperación y cobranza, flags seguros sin secretos) y actualizar fixtures/helpers de `AppConfig` afectados; verificar con `npm run typecheck` y tests de config relacionados en verde. `RecuperacionCobranzaConfig` + defaults/env en `config.ts`; `agenda-fixtures` y 12 literales `AppConfig` actualizados; `npm run typecheck` OK, `tests/config.test.ts` (19) OK.
- [x] 1.2 Agregar migración incremental (siguiente ID disponible, esperado `016`) en `backend/src/shared/migrations.ts` para campañas/ejecuciones, objetivos/seguimiento de contactos y deduplicación por ventana (IDs opacos, sin PHI), con índices necesarios; registrar en `MIGRATIONS` y verificar con test de migración idempotente sobre SQLite real. `MIGRATION_016_RECUPERACION_COBRANZA` (`recuperacion_ejecucion`, `recuperacion_contacto`) + índices/registro; `tests/migrations_016.test.ts` (5) OK; fallout registro 015→016 actualizado; suite de migraciones enfocada (10 files/94 tests) OK.

## 2. Segmentación de inactivos y reglas

- [x] 2.1 Implementar repositorio/servicio de segmentación de inactivos (R8) con criterio determinista configurable sobre actividad asistencial observable existente; verificar con tests Vitest Dado/Cuando/Entonces (SQLite real, fixtures ficticias) inclusión/exclusión según ventana y comportamiento seguro ante config inválida/deshabilitada. `notificaciones/recuperacion-cobranza/{repositorio,service}.ts` (criterio: último `turno.estado='atendido'` fuera de ventana / sin atendidos); `tests/recuperacion_cobranza_service.test.ts` (8) cubre inclusión/exclusión, deshabilitado seguro, config inválida tipada.
- [x] 2.2 Asegurar que la segmentación/consultas devuelven identificadores y metadatos operativos seguros (sin PHI) y quedan restringidas a roles autorizados en la capa de servicio/API; verificar con tests de autorización y aserciones de ausencia de PHI en respuestas/errores. `recuperacion-cobranza.routes.ts` (`requireAuth`+`requireRoles` administracion/recepcion); `tests/recuperacion_cobranza_routes.test.ts` (6) verifica 401/403 profesional, IDs opacos sin PHI.

## 3. Campañas de recuperación

- [x] 3.1 Implementar modelo/servicio de campañas de recuperación con adaptador de envío simulado/estructural (sin credenciales reales), registro de ejecución/seguimiento y límites de frecuencia/dedupe; verificar con tests Dado/Cuando/Entonces que contactos elegibles se registran, duplicados se omiten/difieren y no se expone PHI. `adapter.ts` simulado; ejecución/`recuperacion_contacto` con dedupe por ventana; tests cubren envío simulado, omisión por ventana, sin PHI.
- [x] 3.2 Agregar endpoints administrativos para consultar segmento/estado y ejecutar/consultar campañas con auth/RBAC y manejo de errores tipados; verificar con tests de integración (supertest, SQLite real) cobertura feliz, rechazo no autorizado y respuestas seguras. Endpoints `/api/recuperacion-cobranza/*` montados en `app.ts`; tests supertest cubren flujo feliz, ejecución/listado/detalle, rechazo no autorizado.

## 4. Cobranza automática integrada con caja

- [x] 4.1 Implementar evaluación de deuda pendiente read-only usando contratos existentes de C-11/caja (sin mutar saldos/pagos/movimientos) y generar recordatorios de cobranza elegibles según reglas/ventanas; verificar con tests Dado/Cuando/Entonces que deuda > 0 genera seguimiento elegible, deuda cero no genera contacto y los montos se tratan en centavos enteros. `service.ejecutarCobranza` usa `CajaService.deudaPorPaciente` read-only; tests verifican deuda>0 genera contacto con `monto_centavos` entero, deuda 0 no genera, `pago`/`movimiento_caja` sin cambios.
- [x] 4.2 Implementar deduplicación/ventanas para cobranza y endpoints/operación administrativa mínima para ejecutar/consultar cobranza automática; verificar con tests de integración que re-ejecuciones respetan ventana, rechazan acceso no autorizado y no alteran estado de caja. Dedupe por ventana de cobranza + omisión registrada; endpoints ejecución/consulta; tests de re-ejecución y RBAC/caja intacta.

## 5. Verificación final e integración

- [x] 5.1 Ejecutar verificación final acotada al change: `npm run typecheck` y `npm test` en `backend/` (y checks/frontend solo si el change agrega UI) en verde; verificar por inspección/tests fixtures ficticias, sin credenciales/`.env` reales y sin PHI en logs/respuestas. Backend: `npm run typecheck` OK; `npm test` **82 files / 1068 tests passed**. Sin UI frontend agregada. Fixtures ficticias (IDs/nombres ficticios), envío simulado sin credenciales reales, respuestas/logs sin PHI (aserciones en tests); migración 016 sin PHI.

## Workflow follow-up

- Revisar artefactos de `c-18-recuperacion-inactivos-cobranza` y, cuando el usuario lo pida, iniciar `/opsx:apply` en una nueva solicitud (governance BAJO/R16).
- Tras implementación y verificación, archivar con `/opsx:archive c-18-recuperacion-inactivos-cobranza` y actualizar `CHANGES.md` según el flujo del proyecto.
- Antes de commit/push: cumplir R15 (`tsc --noEmit` + tests, conventional commits, sin secretos).