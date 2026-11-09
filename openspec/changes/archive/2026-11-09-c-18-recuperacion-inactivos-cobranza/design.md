# Design

## Context

C-18 (D-03, BAJO, deps C-15 satisfechas) agrega recuperación de pacientes inactivos y cobranza automática. Ver `proposal.md` para motivación y `specs/notificaciones/recuperacion-cobranza/spec.md` para requisitos. El sistema ya tiene notificaciones operativas (recordatorios/worker, chatbot simulado) y caja/deudas con consultas de saldo/deuda (C-11). Restricciones: TS+Node/Express+SQLite+Vitest (R7), R8 (repo/UoW), R1/R3/R4 (sin PHI en logs/respuestas, acceso controlado), R5/R6 (ARS centavos, enteros exactos), R15 (sin secretos reales).

## Goals / Non-Goals

**Goals:**
- Segmentación configurable de inactivos basada en actividad asistencial observable existente, con salida operativa segura.
- Campañas de recuperación y recordatorios de cobranza con reglas/ventanas, límites anti-duplicación y seguimiento auditable (simulado/estructural, sin proveedores reales).
- Integración **read-only** con caja/deudas para detectar deuda pendiente; no modificar saldos/pagos/movimientos.
- Configuración validada, RBAC en operaciones administrativas, tests Dado/Cuando/Entonces con SQLite real donde la regla lo requiera.

**Non-Goals:**
- Integración real con WhatsApp/SMS/email providers, BSP/Meta, o envío transaccional real.
- Modificar el modelo monetario de C-11, crear pagos/movimientos, o reconciliar contabilidad.
- Scoring avanzado/ML de propensión, segmentación marketing compleja, A/B testing.
- Portal paciente/auto-opt-in UI completa (salvo endpoints/admin mínimos necesarios; detalles UI específicos quedan fuera si no se requieren por la API mínima).

## Decisions

1. **Capacidad y ubicación**: nueva capacidad `notificaciones/recuperacion-cobranza` (spec) e implementación bajo `backend/src/notificaciones/recuperacion-cobranza/` (o módulo equivalente alineado a `notificaciones/*`), reutilizando patrones de recordatorios/caja. *Alternativa*: módulo `cobranzas/` separado — descartado para mantener cohesión con notificaciones y reducir dispersión.

2. **Entrega simulada/estructural**: adaptador de envío simulado (análogo a patrones C-16/C-07) que registra resultado sin credenciales. Contrato extensible para futuro proveedor. *Alternativa*: integración real — fuera de alcance/R15.

3. **Fuente de inactividad**: criterio configurable sobre datos existentes (p. ej. última fecha de turno `atendido`/actividad clínica/turno relevante según disponibilidad real inspeccionada en implementación; el diseño fija que debe ser observable y determinista). Se documentan supuestos si la señal exacta requiere ajuste menor. *Alternativa*: tabla manual de inactivos — menos útil, se evita.

4. **Fuente de deuda**: consultas/repos/servicios de C-11 en modo lectura (deuda pendiente por paciente/concepto) sin mutación. Toda comparación de montos usa centavos enteros. *Alternativa*: recalcular deuda en nuevo esquema — riesgo de divergencia; descartado.

5. **Persistencia**: migración incremental (siguiente ID disponible, esperado `016` si `015` es la última) con tablas para configuración/reglas si aplica, campañas/ejecuciones, objetivos/contactos/seguimiento y claves de idempotencia/frecuencia (IDs opacos, sin PHI). Índices por paciente/fecha/estado para deduplicación. *Alternativa*: solo en memoria — no permite seguimiento reproducible.

6. **Idempotencia y ventanas**: registro de último contacto/elegibilidad por `(paciente, tipo, ventana/campaña)` o equivalente seguro para evitar duplicados indebidos. Evaluaciones dentro de transacciones/reintentos seguros según corresponda (lecturas consistentes; sin cambios de caja). *Alternativa*: sin dedupe — viola requisito.

7. **RBAC/API**: endpoints administrativos protegidos por auth/roles existentes (roles autorizados definidos en implementación alineados a operación/caja/reportes; recepción/profesional sin acceso salvo decisión explícita). Respuestas/logs sin PHI. *Alternativa*: endpoints públicos — inaceptable.

## Risks / Trade-offs

- [Señal de inactividad ambigua con datos actuales] → Definir criterio determinista en implementación basado en tablas reales; cubrir con tests; registrar supuesto si se usa proxy conservador.
- [PHI accidental en mensajes/seguimiento] → Plantillas simuladas con IDs opacos/referencias seguras; tests que inspeccionan payloads/logs de error.
- [Duplicación de contactos] → Claves de dedupe + ventanas/frecuencia + tests de reintento/re-ejecución.
- [Acoplamiento a C-11] → Usar consultas/contratos existentes read-only; tests de integración con fixtures de deuda sin mutar caja.
- [Carga por segmentación masiva] → Alcance MVP acotado (consultas paginables/limitadas o ejecución controlada); optimización diferida.

## Migration Plan

1. Agregar migración incremental y registrar en `MIGRATIONS`; verificar idempotencia sobre SQLite real.
2. Extender config con bloque `recuperacionCobranza` (flags, umbrales/ventanas, límites) sin secretos; actualizar fixtures de `AppConfig`.
3. Implementar repos/servicios/endpoints y tests por grupo; `tsc --noEmit` + `vitest run`.
4. **Rollback**: revertir change antes de archive elimina artefactos; tras migración aplicada en entornos reales, definir rollback de esquema solo si el proyecto lo requiere (fuera del alcance automático aquí).

## Open Questions

- La definición operativa exacta de “actividad relevante” para inactividad (p. ej. último turno `atendido` vs. última consulta clínica) puede fijarse en implementación usando las tablas existentes, siempre que sea determinista y no cambie los requisitos/spec ni el alcance del change. Si no hay señal suficiente, se registrará como supuesto verificable.