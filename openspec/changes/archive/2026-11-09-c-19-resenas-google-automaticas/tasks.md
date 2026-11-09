# Tasks

## 1. Configuración y persistencia

- [x] 1.1 Extender `backend/src/shared/config.ts` con bloque validado `solicitudResena` (habilitación, `linkResena` no secreto, canal predeterminado whatsapp/email, demora/ventana y límites seguros) y actualizar fixtures/helpers de `AppConfig` afectados; verificar con `npm run typecheck` y tests de config relacionados en verde. — OK: `SolicitudResenaConfig`+defaults+parse; `agenda-fixtures` y 12 configs de tests actualizados; `tsc --noEmit` OK; `tests/config.test.ts` verde.
- [x] 1.2 Agregar migración incremental (siguiente ID disponible, esperado `017`) en `backend/src/shared/migrations.ts` para registro de solicitudes de reseña y deduplicación por turno/ventana (IDs opacos, sin PHI, sin secretos), con índices necesarios; registrar en `MIGRATIONS` y verificar con test de migración idempotente sobre SQLite real. — OK: `017` `solicitud_resena` (FK turno/paciente, checks estado/canal, índices turno/paciente/estado/dedupe), `MIGRATIONS` actualizado, `migrations.test.ts` y `migrations_017.test.ts` verdes (idempotente).

## 2. Dominio de solicitud de reseña y dedupe

- [x] 2.1 Implementar repositorio/servicio de solicitud de reseña con adaptador simulado (sin credenciales reales), validación de configuración/link, registro de estados (enviado simulado/omitido/fallido) y deduplicación por turno/regla; verificar con tests Vitest Dado/Cuando/Entonces (SQLite real, fixtures ficticias) envío simulado, config inválida segura, duplicados omitidos y ausencia de PHI. — OK: `backend/src/notificaciones/solicitud-resena/{adapter,repositorio,service}.ts` (simulado, dedupe por turno, config/link inválida => fallido tipado, IDs opacos); `tests/solicitud_resena_service.test.ts` verde.
- [x] 2.2 Asegurar respuestas/errores y registros operativos sin PHI ni secretos y restringir consultas administrativas a roles autorizados; verificar con tests de autorización y aserciones de payloads seguros. — OK: DTO sin `detalle_json`/`link_ref`/PHI, errores tipados, `requireAuth`+`requireRoles(administracion,recepcion)`; tests service/routes verifican autorización y payloads seguros.

## 3. Disparador post-atención

- [x] 3.1 Integrar el disparador en el flujo canónico de transición a `atendido` (best-effort/post-commit según patrón existente) para evaluar elegibilidad y registrar solicitud sin revertir el cambio de estado; verificar con tests Dado/Cuando/Entonces que `atendido` dispara evaluación, otros estados no disparan, funcionalidad deshabilitada omite, y fallos de reseña no alteran el estado del turno. — OK: `turnoEstado.service.ts` invoca `solicitarResenaSeguro` post-commit solo en `atendido` (config bag compat); `turnos.routes.ts` pasa `recordatorio`+`solicitudResena`; sin otros paths de escritura a `atendido` en `src/`; tests servicio cubren trigger/no-trigger/deshabilitado/fallo-no-revierte.
- [x] 3.2 Agregar endpoint(s) administrativo(s) mínimo(s) para consultar solicitudes/estado (si aplica al diseño) con auth/RBAC y errores tipados; verificar con tests de integración (supertest, SQLite real) acceso autorizado, rechazo no autorizado y respuestas sin PHI. — OK: `solicitud-resena.routes.ts` + mount en `app.ts` (`GET /api/solicitudes-resena`, `GET /api/solicitudes-resena/:id`, RBAC admin/recepción); `tests/solicitud_resena_routes.test.ts` verde.

## 4. Verificación final

- [x] 4.1 Ejecutar verificación final acotada al change: `npm run typecheck` y `npm test` en `backend/` (y checks/frontend solo si se agrega UI) en verde; verificar por inspección/tests fixtures ficticias, sin credenciales/`.env` reales, sin llamadas externas reales y sin PHI en logs/respuestas. — OK: `cd backend && npm run typecheck` OK; `npm test` **85 files / 1089 tests passed** (incluye `migrations_017`, `solicitud_resena_service/routes`, fallout migración 017/config). Sin UI frontend agregada. Adapter simulado sin Google/WhatsApp/email/provider reales ni credenciales; `linkResena` no secreto; fixtures ficticias (R1/R12); logs/DTOs/errores sin PHI (IDs opacos). Sin `.env` reales ni secretos commiteados.

## Workflow follow-up

- Revisar artefactos de `c-19-resenas-google-automaticas` y, cuando el usuario lo pida, iniciar `/opsx:apply` en una nueva solicitud (governance BAJO/R16).
- Tras implementación y verificación, archivar con `/opsx:archive c-19-resenas-google-automaticas` y actualizar `CHANGES.md` según el flujo del proyecto.
- Antes de commit/push: cumplir R15 (`tsc --noEmit` + tests, conventional commits, sin secretos).