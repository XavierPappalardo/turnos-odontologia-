# Design

## Context

C-09 (`historia-clinica-odontograma`) está archivado y completo; su migración fue la `008`. C-10 usa la migración `009`. El backend es TypeScript + Node.js + Express con SQLite sin ORM; el acceso a datos es exclusivamente vía `BaseRepository[T]` + `UnitOfWork` con `AuditMixin` (R8). Las tablas existentes relevantes son `paciente` (con `obra_social_plan_id` FK), `obra_social_plan` (con `cobertura_pct`), `turno` y, desde C-09, `odontograma_evento` (con `pieza` y `superficie`). Los roles de auth son `recepcion`, `profesional`, `administracion`; la autorización clínica se rige por `clinica/acceso-hc` (C-09). Ver proposal.md para motivación y alcance.

## Goals / Non-Goals

**Goals:**
- Migración `009` que crea tablas `presupuesto` y `item_presupuesto` con columnas de auditoría (`created_at`, `updated_at`, `deleted_at` para soft-delete).
- API interna Express para CRUD de presupuestos y transiciones de estado (`borrador → enviado → aceptado | rechazado | vencido`).
- `turno_id` NULLABLE: presupuesto standalone sin turno asociado.
- Ítems de presupuesto con `monto_centavos` INTEGER (ARS, nunca float) y referencia opcional a hallazgo del odontograma vía `pieza_fdi` + `superficie`.
- Autocalculo de `cobertura_centavos` y `saldo_centavos` desde `obra_social_plan.cobertura_pct` del paciente.
- Autorización clínica reutilizando el patrón de `clinica/acceso-hc` (C-09).
- Brand types `PresupuestoId`, `ItemPresupuestoId`, etc. (R10).
- Vitest escenarios Dado/Cuando/Entonces para cada regla de negocio (R11).
- Gobernanza MEDIUM (R16): implementar con checkpoints.

**Non-Goals:**
- Planes de tratamiento (agrupadores): fuera de alcance, diferidos a cambio futuro.
- Cobro real / seguimiento de pagos: es C-11.
- Frontend/UI: no se toca en este change.
- Estado `vencido` automático por cron: se registra como transición manual; el programador externo queda para cambio futuro.

## Decisions

### D1. Migración 009 con tablas presupuesto e item_presupuesto (sin ORM)

**Razón:** R7 prohíbe ORMs; R8 exige acceso vía BaseRepository/UnitOfWork. SQLite migration es el patrón establecido (C-09 usó 008).
**Alternativa considerada:** Usar un ORM como Prisma o Sequelize. Rechazado por R7.

### D2. turno_id NULLABLE (presupuesto standalone)

**Razón:** User-confirmed definition #2. Un presupuesto puede emitirse sin turno (segunda opinión). FK opcional a `turno.id`.
**Alternativa considerada:** turno_id NOT NULL (obligatorio). Rechazado: impediría presupuestos sin turno.

### D3. pieza_fdi + superficie como referencia lógica a odontograma_evento (sin FK estricto)

**Razón:** C-09 modela el odontograma como eventos inmutables/event-sourced. Un presupuesto no debe crear una FK hard que impida enmiendas o que acople ciclos de vida. La referencia es válidada aplicacionalmente contra `odontograma_evento` del mismo paciente.
**Alternativa considerada:** FK estricta a `odontograma_evento.id`. Rechazado: acopla demasiado y complica enmiendas.

### D4. Autocalculo de cobertura/saldo en capa de servicio, no en trigger SQL

**Razón:** La lógica de negocio (RN-07) pertenece al servicio, no a triggers. Los CHECKs de integridad (`monto_centavos >= 0`, etc.) sí van en SQL.
**Alternativa considerada:** Triggers SQL para autocalculo. Rechazado: viola separación de responsabilidades y dificulta testing Vitest.

### D5. Estados terminales: aceptado, rechazado, vencido

**Razón:** User-confirmed definition #5. `borrador → enviado` es la única transición inicial; desde `enviado` se va a uno de los tres terminales.
**Alternativa considerada:** Permitir reabrir un presupuesto aceptado. Rechazado: los estados son terminales por definición del change.

### D6. Edición solo en estado borrador

**Razón:** Evita modificar presupuestos ya enviados al paciente. Coherente con la máquina de estados.
**Alternativa considerada:** Edición en cualquier estado. Rechazado: rompería trazabilidad de lo enviado.

### D7. Autorización vía clinica/acceso-hc para ítems clínicos

**Razón:** C-09 ya define quién puede leer/escribir datos clínicos del paciente. Los ítems de presupuesto que referencian odontograma hereden ese mismo control.
**Alternativa considerada:** Rol `recepcion` con lectura de presupuestos. Rechazado por clínica/acceso-hc (recepción recibe 403 en datos clínicos).

## Risks / Trade-offs

- [Riesgo] `pieza_fdi` + `superficie` es referencia lógica, no FK hard → un ítem podría referenciar un evento que luego sea enmendado. → Mitigación: validar aplicaciónmente que exista un evento vigente del odontograma del paciente con esa pieza/superficie al crear el ítem; no se bloquea por enmiendas posteriores.
- [Riesgo] Estado `vencido` no se autotranscurre (sin cron en C-10). → Mitigación: se documenta como transición manual; el programador externo es cambio futuro.
- [Trade-off] Sin seguimiento de pagos en C-10 → `saldo_centavos` es informativo; el cobro real es C-11.
- [Trade-off] No hay planes de tratamiento agrupadores → cada presupuesto es independiente; la agrupación se deferirá a cambio futuro.

## Migration Plan

1. Crear archivo de migración SQL `009` con `CREATE TABLE presupuesto` y `CREATE TABLE item_presupuesto`, columnas de auditoría, FKs, CHECKs e índices.
2. Ejecutar migración en entorno de desarrollo y test (SQLite en memoria para Vitest, SQLite real para dev).
3. Verificar esquema con escenario Vitest: abrir base con migraciones 001→009 y confirmar existencia de tablas y columnas.
4. Rollback: si falla en producción, ejecutar `DROP TABLE item_presupuesto; DROP TABLE presupuesto;` (sin datos productivos aún, C-10 es nuevo).

## Open Questions

Ninguna. Todas las definiciones de usuario están confirmadas (alcance, turno_id nullable, odontograma link, autocalculo cobertura/saldo, estados, gobernanza MEDIUM).
