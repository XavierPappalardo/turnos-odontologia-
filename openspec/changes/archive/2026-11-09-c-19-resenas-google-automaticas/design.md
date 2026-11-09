# Design

## Context

C-19 (D-04, BAJO, deps C-15 satisfechas) solicita reseñas tras atención (`atendido`). Ver `proposal.md` y `specs/notificaciones/solicitud-resena/spec.md`. La transición a `atendido` ocurre en flujos de agenda (p. ej. `cambiarEstadoTurno` y caminos que aplican la máquina de estados); los efectos secundarios post-transacción deben seguir el patrón seguro existente (no abortar la operación principal). Restricciones: TS+Node/Express+SQLite+Vitest (R7), R8, R1/R3/R4, R15 (sin secretos/credenciales reales; sin Google/WhatsApp/email provider real), R12.

## Goals / Non-Goals

**Goals:**
- Disparar evaluación al alcanzar `atendido` de forma determinista y best-effort respecto del cambio de estado ya confirmado.
- Generar solicitud simulada con link configurable, canal metadato (whatsapp/email), registro y dedupe por turno/ventana.
- Configuración validada sin secretos; RBAC en consultas operativas; tests Dado/Cuando/Entonces.

**Non-Goals:**
- Integración real con Google Business Profile/Places, WhatsApp BSP/Meta o email SMTP/provider.
- Verificar que la reseña fue publicada en Google, moderación, respuestas automáticas.
- Campañas masivas de reseñas no vinculadas a turnos atendidos.
- UI compleja de marketing (solo API/admin mínima si aplica).

## Decisions

1. **Capacidad/módulo**: `notificaciones/solicitud-resena` implementada bajo `backend/src/notificaciones/solicitud-resena/` (adapter simulado, repos, service, routes opcionales admin) alineada a patrones C-07/C-18. *Alternativa*: acoplar todo en agenda — descartado por cohesión.

2. **Integración con transición `atendido`**: invocar evaluación desde los puntos que materializan `atendido` (mínimo `cambiarEstadoTurno` post-commit/best-effort; revisar también flujos públicos/portal si pueden llegar a `atendido` — en el dominio actual `atendido` es posterior a `presente`; aplicar en los puntos donde la transición se ejecuta). Fallos de reseña se registran/loguean con IDs opacos y nunca revierten el turno. *Alternativa*: worker polling — más complejo; trigger directo es suficiente.

3. **Entrega simulada**: adaptador que produce `enviado_simulado` con referencia segura al link configurado; sin llamadas externas. *Alternativa*: real — fuera de alcance.

4. **Persistencia**: migración incremental (siguiente ID disponible, esperado `017`) con tabla de solicitudes (`turno_id`, `paciente_id` opaco, canal, link_ref/config snapshot seguro o referencia no secreta, estado, motivo, dedupe key, timestamps) e índices por `turno_id`/fecha. *Alternativa*: solo log — no cumple registro/dedupe.

5. **Dedupe**: unicidad efectiva por `turno_id` (una solicitud efectiva por atención) más ventana configurable opcional para reintentos controlados si se define; omisiones registradas. *Alternativa*: sin dedupe — riesgo de spam.

6. **Config**: `solicitudResena` (habilitado, `linkResena`, `canalPredeterminado` whatsapp|email, `demoraMinutos`/ventana si aplica, límites) validada; `linkResena` es dato de configuración operativo (no secreto), puede ser placeholder en dev/tests. *Alternativa*: hardcode — inflexible.

7. **RBAC**: consultas/listado restringidas a `administracion`/`recepcion` (operación) o solo `administracion` según mínima necesidad; endpoints no públicos. *Alternativa*: público — inaceptable.

## Risks / Trade-offs

- [Integración incompleta en todos los caminos a `atendido`] → Cubrir el servicio canónico de transición y tests de integración sobre el flujo real; documentar puntos cubiertos.
- [PHI en mensajes/registros] → Solo IDs opacos/referencias seguras; tests de no-PHI.
- [Duplicados por concurrencia/reintento] → Dedupe por `turno_id` + verificación transaccional/constraint/idempotencia; tests.
- [Link mal configurado] → Validación/omisión tipada segura; nunca bloquear atención.

## Migration Plan

1. Agregar migración incremental y registrar en `MIGRATIONS`; test idempotente SQLite real.
2. Extender config/fixtures `AppConfig`.
3. Implementar módulo + integración post-atención + tests; `tsc --noEmit` + `vitest run`.
4. **Rollback**: revertir change; migración aplicada en producción requiere manejo manual si aplica.

## Open Questions

- Si existen caminos alternativos que persisten `atendido` fuera del servicio canónico, se identificarán en implementación y se cubrirán de forma mínima y determinista sin cambiar el alcance/spec; de lo contrario se documentará el punto único soportado.