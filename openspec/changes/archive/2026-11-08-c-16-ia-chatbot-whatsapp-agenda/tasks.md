# Tasks

## 1. Configuración y persistencia conversacional

- [x] 1.1 Extender `backend/src/shared/config.ts` y su validación (`loadConfig`/tests si existen) con bloque `chatbot` (modo simulado habilitado por default seguro, `sessionTtlSeconds`, `maxIntentosInvalidos`, límites de rate) sin secretos ni defaults de credenciales reales; verificar con `npm run typecheck` y tests de config afectados en verde.
- [x] 1.2 Agregar `MIGRATION_014_CHATBOT_CONVERSACION` en `backend/src/shared/migrations.ts` (tabla `chatbot_conversacion` con `conversation_id` opaco único, intención/paso, `slots_json` solo con IDs opacos, contadores, `expires_at`, timestamps, índices útiles) y registrarla en `MIGRATIONS`; verificar con test de migraciones que la migración 014 se aplica idempotentemente y el esquema esperado existe.

## 2. Adaptador WhatsApp simulado y normalización

- [x] 2.1 Implementar en `backend/src/notificaciones/chatbot/` la interfaz/tipos del adaptador (`normalizeInbound`, `send/outbound`) y `SimulatedWhatsAppAdapter` sin llamadas externas ni credenciales; verificar con tests unitarios que normaliza payloads válidos/inválidos y produce salidas sin PHI ni secretos.
- [x] 2.2 Implementar normalización/validación de entrada del endpoint simulado (IDs opacos requeridos, payload acotado, códigos de error genéricos sin eco sensible); verificar con tests de ruta/servicio que entradas inválidas responden `4xx` sin PHI.

## 3. Estado conversacional y orquestación de intenciones

- [x] 3.1 Implementar `ConversacionRepository` (R8, UoW cuando corresponda) para crear/leer/actualizar/expirar sesiones por `conversation_id` opaco, respetando TTL y `maxIntentosInvalidos`; verificar con tests Dado/Cuando/Entonces que el contexto multi-paso persiste, expira y limita intentos sin almacenar PHI.
- [x] 3.2 Implementar `IntentResolver`/orquestador determinista para `agendar`, `confirmar`, `cancelar`, `reprogramar` con recolección guiada de slots faltantes y confirmación explícita antes de mutar; verificar con tests que intenciones soportadas avanzan pasos y que ambigüedad/límites devuelven respuestas seguras.

## 4. Integración con agenda y transiciones de turno

- [x] 4.1 Implementar el flujo `agendar` del chatbot reutilizando disponibilidad y la lógica transaccional de creación con validación de solape profesional/sillón, bloqueos y anticipación mínima (R9/RN-01/RN-02/RN-04/RN-06), usando referencias opacas/ficticias; verificar con tests Vitest Dado/Cuando/Entonces sobre SQLite real los casos: slot disponible crea turno, solape profesional/sillón o bloqueo rechaza, anticipación insuficiente rechaza.
- [x] 4.2 Implementar `confirmar`/`cancelar`/`reprogramar` reutilizando la semántica de transiciones/validaciones existente (equivalente a acciones C-06), validando el nuevo horario en reprogramación como reserva nueva; verificar con tests que transiciones válidas actualizan estado, transiciones inválidas/cancelación fuera de regla rechazan, y reprogramación con conflicto no persiste cambio parcial.

## 5. API pública simulada, montaje y hardening

- [x] 5.1 Agregar `chatbotRouter` bajo `/api/public` en `backend/src/shared/app.ts` con endpoint simulado (p. ej. WhatsApp simulado), rate limiting, manejo de errores vía `errorHandler` y respuestas/logs solo con IDs opacos; verificar con tests de integración (supertest) los escenarios de ingreso normalizado, errores sin PHI y operación en modo simulado sin secretos.
- [x] 5.2 Ejecutar verificación final acotada al cambio: `npm run typecheck` y `npm test` en `backend/` (o suite equivalente del proyecto) en verde; verificar además, por inspección/tests, que fixtures son ficticias y que no se agregaron credenciales/`.env` reales ni logs con PHI. Verificado: `tsc --noEmit` OK; suite completa `74 files / 1020 tests` en verde (incluye fix de expectativas de migraciones existentes por agregado de `014`); fixtures/IDs ficticios; sin secretos/`.env` reales ni PHI en código/logs del chatbot.

## Workflow follow-up

- Revisar los artefactos de `c-16-ia-chatbot-whatsapp-agenda` y, cuando el usuario lo pida, iniciar `/opsx:apply` en una nueva solicitud.
- Tras la implementación y verificación requeridas, archivar el change con `/opsx:archive c-16-ia-chatbot-whatsapp-agenda` y actualizar el estado en `CHANGES.md` según el flujo del proyecto.
- Antes de commit/push de la implementación futura: cumplir R15 (`tsc --noEmit` + tests, conventional commits, sin secretos).
