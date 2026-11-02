# Proposal

## Why

La clínica necesita emitir presupuestos odontológicos (F-06, CU-5/CU-6 del KB-02) sin depender de un turno asociado, pudiendo vincular ítems a hallazgos del odontograma (C-09) y autocalcular cobertura y saldo de obra social por plan del paciente. Los planes de tratamiento (agrupadores) y el cobro real quedan fuera de este change y se deferirán a cambios futuros (C-11 para cobro, cambio futuro para planes de tratamiento).

## What Changes

- Migración `009`: nuevas tablas `presupuesto` y `item_presupuesto` en SQLite (sin ORM).
- Tabla `presupuesto`: `id`, `paciente_id` (FK), `turno_id` (FK NULLABLE — presupuesto standalone posible), `estado` (`borrador`/`enviado`/`aceptado`/`rechazado`/`vencido`), `total_centavos`, `cobertura_centavos`, `saldo_centavos`, `obra_social_plan_id` (FK NULLABLE), `created_at`, `updated_at`, `deleted_at` (soft delete).
- Tabla `item_presupuesto`: `id`, `presupuesto_id` (FK), `descripcion`, `monto_centavos`, `pieza_fdi` (NULLABLE, referencia a odontograma_evento de C-09), `superficie` (NULLABLE), `created_at`, `deleted_at`.
- API interna (Express): `GET/POST/PATCH/DELETE /api/presupuestos` y `POST /api/presupuestos/:id/transicion` para transiciones de estado (`borrador → enviado → aceptado|rechazado|vencido`).
- Autocalculo de `cobertura_centavos` y `saldo_centavos` a partir de `obra_social_plan.cobertura_pct` del paciente al crear/actualizar.
- Acceso a datos SOLO vía `BaseRepository[T]` + `UnitOfWork` (con `AuditMixin`); nunca SQL suelto (R8).
- Brand types obligatorios: `PresupuestoId`, `ItemPresupuestoId`, `PacienteId`, `TurnoId`, `ObraSocialPlanId` (R10).
- Vitest escenarios `Dado/Cuando/Entonces` para cada regla de negocio (R11).
- Gobernanza MEDIUM (R16): implementar con checkpoints.

## Capabilities

### New Capabilities

- `clinica/presupuestos`: Emisión, edición, consulta y transición de estados de presupuestos odontológicos, con autocalculo de cobertura/saldo de obra social, vínculo opcional a turno, referencia a hallazgos del odontograma (C-09) por ítem, y máquina de estados `borrador → enviado → aceptado/rechazado/vencido`. Crea `specs/clinica/presupuestos/spec.md`.

### Modified Capabilities

- Ninguna. C-10 introduce una nueva capacidad sin modificar requisitos de capacidades existentes.

## Impact

- Backend: nueva migración (009), nuevos repositorios (`PresupuestoRepository`, `ItemPresupuestoRepository`), servicio de presupuestos, nuevas rutas Express, middlewares de autorización (reusa `clinica/acceso-hc` para lectura clínica vinculada), integración con `core/models` y `obra_social_plan`.
- Tests: Vitest escenarios Dado/Cuando/Entonces para cada regla de negocio (cobertura/saldo, máquina de estados, vínculo odontograma, autorización).
- No se toca frontend (UI es no-goal de este change).
- No se toca caja/cobro real (es C-11).
- No se crean planes de tratamiento (agrupadores) — deferidos a cambio futuro.
