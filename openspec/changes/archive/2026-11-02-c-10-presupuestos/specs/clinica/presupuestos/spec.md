# Spec Delta — clinica/presupuestos

## Purpose

Permite emitir, editar, consultar y transicionar estados de presupuestos odontológicos de forma independiente de un turno, con autocalculo de cobertura y saldo de obra social por plan del paciente y referencia opcional a hallazgos del odontograma (C-09) por ítem.

## ADDED Requirements

### Requirement: Creación de presupuesto sin turno obligatorio

El sistema SHALL permitir crear un presupuesto con `turno_id` NULLABLE, de modo que un presupuesto pueda emitirse sin turno asociado (p. ej., segunda opinión). El presupuesto queda en estado `borrador` al crearse.

#### Scenario: Presupuesto standalone sin turno

- **WHEN** se crea un presupuesto con `turno_id` nulo y `paciente_id` válido
- **THEN** el sistema responde `201`, crea el presupuesto en estado `borrador` y `turno_id` queda `NULL`

#### Scenario: Presupuesto vinculado a un turno

- **WHEN** se crea un presupuesto con un `turno_id` que pertenece al paciente
- **THEN** el sistema responde `201` y el presupuesto conserva ese `turno_id`

#### Scenario: Turno de otro paciente rechazado

- **WHEN** se crea un presupuesto con un `turno_id` que pertenece a otro paciente
- **THEN** el sistema responde `400` y no persiste el presupuesto

### Requirement: Ítems del presupuesto con monto en centavos

El sistema SHALL permitir agregar ítems al presupuesto con `monto_centavos` INTEGER NOT NULL CHECK (>= 0), moneda ARS, nunca float. Cada ítem tiene `descripcion`, `monto_centavos` y opcionalmente `pieza_fdi` + `superficie` que referencian un hallazgo del odontograma (C-09).

#### Scenario: Ítem con monto válido en centavos

- **WHEN** se agrega un ítem con `monto_centavos` 50000 (ARS 500,00)
- **THEN** el sistema responde `201` y persiste el ítem con ese valor entero

#### Scenario: Ítem con monto negativo rechazado

- **WHEN** se agrega un ítem con `monto_centavos` negativo
- **THEN** el sistema responde `400` y no persiste el ítem

#### Scenario: Ítem vinculado a hallazgo del odontograma

- **WHEN** se agrega un ítem con `pieza_fdi` `16` y `superficie` `O` que coinciden con un evento vigente del odontograma del paciente
- **THEN** el sistema responde `201` y el ítem referencia ese hallazgo clínico

#### Scenario: Ítem con pieza FDI inválida rechazado

- **WHEN** se agrega un ítem con `pieza_fdi` `99` (fuera de catálogo FDI)
- **THEN** el sistema responde `400` y no persiste el ítem

### Requirement: Total del presupuesto es suma de ítems

El sistema SHALL calcular `total_centavos` del presupuesto como la suma de `monto_centavos` de todos sus ítems, y SHALL recalcularlo al agregar, editar o eliminar ítems.

#### Scenario: Total es suma de ítems

- **WHEN** un presupuesto tiene dos ítems de 30000 y 20000 centavos
- **THEN** `total_centavos` del presupuesto es 50000

#### Scenario: Total se recalcula al editar un ítem

- **WHEN** se edita un ítem de 30000 a 40000 centavos en un presupuesto con total 50000
- **THEN** `total_centavos` pasa a 60000

### Requirement: Autocalculo de cobertura y saldo por obra social

El sistema SHALL autocalcular `cobertura_centavos` = `total_centavos` * `cobertura_pct` / 100 y `saldo_centavos` = `total_centavos` - `cobertura_centavos` basándose en el `obra_social_plan` del paciente, al crear y al actualizar el presupuesto. Si el paciente no tiene plan de obra social, `cobertura_centavos` es 0 y `saldo_centavos` es igual a `total_centavos`.

#### Scenario: Cobertura calculada por plan de obra social

- **WHEN** se crea un presupuesto de 50000 centavos para un paciente con plan de cobertura_pct 60
- **THEN** `cobertura_centavos` es 30000 y `saldo_centavos` es 20000

#### Scenario: Sin plan de obra social, cobertura es cero

- **WHEN** se crea un presupuesto de 50000 centavos para un paciente sin `obra_social_plan_id`
- **THEN** `cobertura_centavos` es 0 y `saldo_centavos` es 50000

#### Scenario: Cobertura se recalcula al cambiar plan

- **WHEN** un presupuesto borrador de 50000 centavos cambia su paciente a uno con cobertura_pct 40
- **THEN** `cobertura_centavos` pasa a 20000 y `saldo_centavos` a 30000

### Requirement: Máquina de estados del presupuesto

El sistema SHALL implementar la máquina de estados `borrador → enviado → aceptado | rechazado | vencido`. Desde `borrador` solo se puede ir a `enviado`. Desde `enviado` se puede ir a `aceptado`, `rechazado` o `vencido`. `aceptado`, `rechazado` y `vencido` son estados terminales. No hay seguimiento de pagos (eso es C-11).

#### Scenario: Borrador a enviado

- **WHEN** se transiciona un presupuesto de `borrador` a `enviado`
- **THEN** el sistema responde `200` y el estado es `enviado`

#### Scenario: Enviado a aceptado

- **WHEN** se transiciona un presupuesto de `enviado` a `aceptado`
- **THEN** el sistema responde `200` y el estado es `aceptado` (terminal)

#### Scenario: Enviado a rechazado

- **WHEN** se transiciona un presupuesto de `enviado` a `rechazado`
- **THEN** el sistema responde `200` y el estado es `rechazado` (terminal)

#### Scenario: Enviado a vencido

- **WHEN** se transiciona un presupuesto de `enviado` a `vencido`
- **THEN** el sistema responde `200` y el estado es `vencido` (terminal)

#### Scenario: Transición inválida rechazada

- **WHEN** se intenta transicionar de `borrador` directamente a `aceptado`
- **THEN** el sistema responde `400` y el estado permanece `borrador`

#### Scenario: Estado terminal no acepta más transiciones

- **WHEN** se intenta transicionar un presupuesto ya `aceptado`
- **THEN** el sistema responde `400` y el estado permanece `aceptado`

### Requirement: Edición solo en estado borrador

El sistema SHALL permitir editar un presupuesto (ítems, totals, cobertura) solo mientras esté en estado `borrador`. En cualquier otro estado, la edición es rechazada.

#### Scenario: Editar presupuesto en borrador

- **WHEN** se edita un presupuesto en estado `borrador`
- **THEN** el sistema responde `200` y aplica los cambios

#### Scenario: Editar presupuesto enviado rechazado

- **WHEN** se edita un presupuesto en estado `enviado`
- **THEN** el sistema responde `400` y no aplica cambios

### Requirement: Autorización por acceso clínico (C-09)

El sistema SHALL aplicar la autorización de `clinica/acceso-hc` (C-09) a la lectura y escritura de presupuestos que referencian hallazgos del odontograma: solo `profesional` con acceso vigente al paciente (titular o delegado) puede leer/escribir ítems vinculados a eventos del odontograma; `recepcion` y `administracion` reciben `403`.

#### Scenario: Profesional con acceso lee presupuesto con ítems clínicos

- **WHEN** un `profesional` con acceso vigente al paciente consulta un presupuesto cuyos ítems referencia hallazgos del odontograma
- **THEN** el sistema responde `200` con los ítems

#### Scenario: Recepción no lee ítems clínicos del presupuesto

- **WHEN** un `recepcion` consulta un presupuesto con ítems vinculados al odontograma
- **THEN** el sistema responde `403`

### Requirement: Migración 009 de tablas presupuesto e item_presupuesto

El sistema SHALL aplicar la migración `009` que crea las tablas `presupuesto` y `item_presupuesto` con columnas de auditoría (`created_at`, `updated_at`, `deleted_at` para soft-delete), claves foráneas a `paciente`, `turno` y `obra_social_plan`, y CHECKs de integridad financiera (`monto_centavos >= 0`, `total_centavos >= 0`, `cobertura_centavos >= 0`, `saldo_centavos >= 0`).

#### Scenario: Esquema tras migración 009

- **WHEN** se abre una base con migraciones 001→009
- **THEN** existen las tablas `presupuesto` y `item_presupuesto` con sus columnas, FKs y CHECKs

#### Scenario: Soft delete de presupuesto

- **WHEN** se elimina lógicamente un presupuesto (`deleted_at` no nulo)
- **THEN** el presupuesto no aparece en consultas activas pero persiste en la base
