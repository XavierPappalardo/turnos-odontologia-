# Design

## Context

Ver `proposal.md` (Why). El backend ya expone reserva pública con validación de disponibilidad/overlaps/bloqueos (`agenda/reservaOnline.*`), acciones de turno por token con máquina de estados (`agenda/turnoToken.*`), recordatorios con adaptador conceptual de canal WhatsApp/email y worker (`notificaciones/recordatorio.*`), rate limiting público reutilizable (`agenda/publicRateLimiter`), y configuración inyectable (`shared/config.ts`). SQLite (`node:sqlite`/`DatabaseSync`) + migraciones ordenadas en `shared/migrations.ts` (hasta 013) + Express (`shared/app.ts`) son la base. Restricciones: R1/R3 (sin PHI en logs/fixtures/respuestas), R5/R6 (ARS centavos), R7 (stack inamovible), R8 (acceso a datos vía repositorios/UoW), R9 (escrituras de turno con validación de solape en `BEGIN IMMEDIATE`), R11 (Vitest Dado/Cuando/Entonces, SQLite real en reglas críticas), R15 (sin secretos, conventional commits, `tsc --noEmit` + tests), RN-10 (costo WhatsApp trasladado, no cobrado aquí) y RN-11/P-06 (preferencia de canal no validada).

## Goals / Non-Goals

**Goals:**
- Entregar una **estructura funcional y testeable** de chatbot WhatsApp para agendar/confirmar/cancelar/reprogramar 24/7, sin credenciales reales, integrada al stack existente.
- Reutilizar la semántica vigente de agenda (anti-solapamiento profesional+sillón, bloqueos, anticipación, transiciones de estado) en lugar de duplicar reglas.
- Mantener un límite claro de integración mediante un **adaptador WhatsApp desacoplado** (simulado por defecto) y estado conversacional acotado/expirable.
- Garantizar privacidad operativa (IDs opacos, sin PHI/secretos en logs, respuestas y fixtures).

**Non-Goals:**
- Integración real con WhatsApp Cloud API/BSP, envío real a Meta, plantillas aprobadas, webhooks firmados de producción o facturación de mensajes.
- NLU/LLM productivo, comprensión de lenguaje natural abierta o entrenamiento de modelos; el MVP usa orquestación determinista por intención/pasos (con punto de extensión).
- Autenticación fuerte de paciente por teléfono real, verificación OTP, o resolución de identidad contra datos reales; el flujo simulado usa referencias opacas/ficticias.
- Cambios normativos a specs existentes (`agenda/crear-turno`, `notificaciones/recordatorios`, reserva pública, auth) ni nuevas reglas de negocio de solapamiento/anticipación.
- Portal paciente (C-17), campañas/cobranza/reseñas (C-18/C-19), UI frontend del chatbot.

## Decisions

1. **Módulo y contrato interno (nuevo dominio acotado)**
   - Crear `backend/src/notificaciones/chatbot/` con separación: `whatsapp.adapter.ts` (interfaz + simulador), `conversacion.repository.ts` (persistencia), `conversacion.service.ts` (máquina de estados/intenciones), `chatbot.routes.ts` (endpoint público simulado), tipos y utilidades de normalización.
   - *Rationale*: sigue la organización existente (`notificaciones/recordatorios`) y aísla el proveedor. *Alternativa*: módulo top-level `integraciones/whatsapp` — descartado por consistencia con `notificaciones/` y menor dispersión en este MVP.

2. **Adaptador WhatsApp simulado (sin secretos)**
   - Definir `WhatsAppAdapter` con `send(message)`/`normalizeInbound(payload)` y una implementación `SimulatedWhatsAppAdapter` que registra/envía en memoria o retorna payload normalizado para tests. La ruta pública acepta un payload normalizado de prueba (p. ej. `POST /api/public/chatbot/whatsapp/simulado`) y no verifica firmas Meta.
   - *Rationale*: cumple CHANGES/KB ("estructura sin credenciales reales") y permite TDD sin red. *Alternativa*: cliente HTTP real detrás de flag — posible a futuro, pero fuera de alcance y requeriría secretos/R15; no se implementa ahora.

3. **Orquestación determinista con punto de extensión "IA"**
   - La intención se resuelve por parser determinista (comandos/palabras clave y pasos guiados, p. ej. `agendar`, `confirmar <turno_ref>`, `cancelar <turno_ref>`, `reprogramar <turno_ref>`) con respuestas guiadas para recolectar slots faltantes. La interfaz de `IntentResolver` permite sustituir por NLU/LLM luego sin cambiar el contrato de efectos.
   - *Rationale*: ejecutable, testeable y seguro en MVP; evita dependencia externa/PHI hacia LLMs. *Alternativa*: LLM directo en el loop — descartado por secretos, costo, no determinismo en tests y riesgo de PHI.

4. **Estado conversacional persistido en SQLite (migración 014)**
   - Agregar `MIGRATION_014_CHATBOT_CONVERSACION` en `shared/migrations.ts` con tabla `chatbot_conversacion` (campos mínimos: `id`, `conversation_id` UNIQUE opaco, `intencion`, `paso`, `slots_json` TEXT con solo IDs opacos/referencias ficticias, `intentos_invalidos`, `expires_at`, `created_at`, `updated_at`) e índices por `conversation_id`/`expires_at`. Acceso vía `ConversacionRepository` + `UnitOfWork` para actualizaciones atómicas del paso.
   - *Rationale*: sobrevive reinicios y permite expiración determinista; consistente con R8/patrones. *Alternativa*: solo memoria — simple pero frágil al reiniciar; se permite caché, pero la fuente de verdad es SQLite para el comportamiento especificado.

5. **Reutilización de reglas de agenda (sin duplicar solapes)**
   - **Agendar**: delegar en `reservarTurnoOnline`/servicios de disponibilidad o en la misma composición transaccional que usa `TurnoRepository` + `BloqueoRepository` con `UnitOfWork`/`BEGIN IMMEDIATE` para escrituras que validan solape (R9). No reimplementar la consulta de intersección.
   - **Confirmar/cancelar/reprogramar**: reutilizar la lógica de transición/validación equivalente a `turnoToken`/`turnoEstado` (extraer/helpers internos si es necesario en apply, manteniendo comportamiento) o invocar servicios existentes con un contexto de autorización conversacional simulado y opaco; nunca exponer tokens reales en logs.
   - *Rationale*: preserva RN-01/RN-02/RN-04/RN-06 y reduce regresiones. *Alternativa*: reescribir validaciones en chatbot — descartado.

6. **Identidad de paciente y referencias opacas (MVP simulado)**
   - El payload simulado puede incluir `paciente_id` opaco/ficticio (ya usado en reserva online) o un `sujeto_ref` opaco para asociar la conversación; los turnos se refieren por `turno_id`/referencia opaca en el contexto de prueba. No se almacenan ni registran teléfonos reales.
   - *Rationale*: evita PHI/R3 y permite tests; refleja la limitación de estructura sin integración real. *Alternativa*: resolver por teléfono real — incompatible con R1/R3 en este change sin un modelo de consentimiento/PII segregado.

7. **Configuración y anti-abuso**
   - Extender `AppConfig`/`loadConfig` con `chatbot` (p. ej. `enabledSimulado`, `sessionTtlSeconds`, `maxIntentosInvalidos`, `rateMax/rateWindowSeconds`) con defaults seguros y sin secretos. Reusar `PublicRateLimiter` o instancia equivalente para el endpoint simulado.
   - *Rationale*: consistencia con config existente y fail-fast sin secretos. *Alternativa*: constantes hardcodeadas — descartado.

8. **Montaje de rutas**
   - Registrar `chatbotRouter(db, config)` en `shared/app.ts` bajo `/api/public` (alineado a endpoints públicos/simulados existentes como reserva/recordatorios/turnoToken). Respuestas JSON, errores vía `errorHandler` existente sin PHI.

## Risks / Trade-offs

- [Ambigüedad conversacional / intención mal resuelta] → parser determinista guiado, confirmación explícita antes de mutar agenda, mensajes de reintento acotados. *Trade-off*: menor flexibilidad que un LLM real.
- [Identidad de paciente débil en modo simulado] → solo referencias opacas/ficticias; no se infiere identidad por teléfono. *Mitigación futura*: C-17 o flujo autenticado/OTP fuera de C-16.
- [Abuso/spam del endpoint público simulado] → rate limiting, TTL de sesión, máximo de intentos, payloads acotados. *Trade-off*: puede rechazar ráfagas legítimas de prueba.
- [Doble escritura/solape en concurrencia] → reutilizar transacciones/consultas de solape existentes (`BEGIN IMMEDIATE` en la capa de agenda). *Mitigación*: tests con SQLite real para casos críticos.
- [Costo WhatsApp (RN-10) y canal no validado (RN-11/P-06)] → documentado como restricción operativa; no se envían mensajes reales ni se integra facturación. *Trade-off*: valor de negocio completo diferido a integración real.
- [Acoplamiento a servicios internos] → usar interfaces/funciones de servicio existentes; si se requiere extracción en apply, hacerlo con refactor mínimo y tests previos verdes.

## Migration Plan

- **Deploy (aplicación de cambios de código/DB en apply, no en este workflow)**: agregar migración `014` al registro ordenado; al iniciar, `runMigrations` la aplica idempotentemente. Nuevas variables de config de chatbot son opcionales con defaults seguros (sin secretos). Endpoint simulado queda bajo `/api/public` y puede deshabilitarse por config si se decide operar solo internamente.
- **Rollback**: revertir el commit del change; la tabla `chatbot_conversacion` es aditiva y puede permanecer sin uso. No hay migración destructiva. Si se necesita limpieza manual, documentar `DROP TABLE` solo en entornos no productivos (fuera de migraciones automáticas).
- **Datos**: solo datos ficticios en tests/seed de prueba; no migrar PHI.

## Open Questions

- **Resolución de identidad en producción real** (teléfono WhatsApp → paciente): diferida a la integración real / C-17; el contrato simulado usa IDs opacos. Resolver antes de conectar Meta no cambia la semántica de agenda aquí especificada, pero sí la capa de autenticación/PII.
- **Alcance exacto de "IA" en releases posteriores** (reglas vs NLU vs LLM con guardrails): queda detrás de `IntentResolver`; decisión de proveedor/modelo diferida por R15/costos/PHI.
