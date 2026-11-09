# Proposal

## Why

Tras la atención, el sistema no solicita reseñas de forma sistemática, perdiendo una oportunidad de reputación y retroalimentación (D-04, CU-8). C-19 agrega solicitudes automáticas (estructurales/simuladas) al completar un turno, con registro y controles de privacidad, sin depender de APIs o credenciales reales.

## What Changes

- **Disparador post-atención:** al registrar la transición válida de un turno a estado `atendido`, el sistema evalúa la elegibilidad para solicitud de reseña según configuración.
- **Envío simulado/estructural del link de reseña:** genera una solicitud con canal configurable (WhatsApp/email como metadato operativo) y un link de reseña configurable; el envío es simulado (sin credenciales reales de Google/WhatsApp/email/BSP).
- **Registro de solicitudes/enviados:** persiste intentos/resultados (elegible, enviado simulado, omitido/fallido) con identificadores opacos y deduplicación por ventana/regla para evitar reenvíos indebidos.
- **Configuración segura:** habilitación, link de reseña, canal preferido, demora/ventana y límites, sin secretos.
- **Tests:** disparador/elegibilidad, generación/registro simulado, dedupe y controles de seguridad/PHI con Vitest Dado/Cuando/Entonces (SQLite real donde corresponda).

## Capabilities

### New Capabilities
- `notificaciones/solicitud-resena`: Solicitud automática post-atención de reseñas mediante link configurable, con disparo al atender turnos, envío simulado, registro y deduplicación con controles de privacidad.

### Modified Capabilities
- (none)

## Impact

- **Agenda (integración acotada):** hook/punto de integración al cambiar estado a `atendido` (p. ej. flujo de `cambiarEstadoTurno` u orquestación equivalente) para disparar evaluación sin romper la transacción de estado; comportamiento post-commit/best-effort según diseño.
- **Backend notificaciones:** nuevo módulo/repos/servicio/adaptador simulado bajo `backend/src/notificaciones/` alineado a patrones existentes.
- **Config/migración:** bloque `solicitudResena` y migración incremental para registro de solicitudes/dedupe (IDs opacos, sin PHI).
- **APIs admin (mínimas):** consulta de solicitudes/ejecuciones o estado operativo con RBAC, si el diseño lo requiere; sin exposición pública de PHI.
- **Governance:** BAJO (R16). Depende de C-15 (satisfecha). Restricciones: R1/R3/R4/R7/R8/R15/R12.