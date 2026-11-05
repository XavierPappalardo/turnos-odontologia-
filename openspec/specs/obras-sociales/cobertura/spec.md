# obras-sociales/cobertura Specification

## Purpose
Cálculo (RN-07), registro por turno/prestación y consulta del cargo de obra social con el **porcentaje general del plan** (sin nomenclador ni pct diferencial): `cobertura_centavos` que paga el plan y `saldo_paciente_centavos`, con snapshot del porcentaje del plan, aritmética exacta en centavos enteros (R2/R5/R6), prevención de cargos duplicados y trazabilidad auditable.

## Requirements

### Requirement: Registro de cobertura por turno con cálculo RN-07

El sistema SHALL exponer `POST /api/obras-sociales/coberturas` (roles `recepcion` y `administracion`) para registrar el cargo de obra social de un turno con body `{turno_id, monto_total_centavos, obra_social_plan_id?}`. SHALL calcular `cobertura_centavos` con el pct vigente del plan sobre el importe declarado de la prestación (guard `BigInt`, ver validaciones) y `saldo = monto − cobertura`; persiste ambos con snapshot del pct. Elegibilidad y límite de cálculo: ver escenarios.

#### Scenario: Cargo con plan del paciente

- **WHEN** `recepcion` registra `monto_total_centavos: 50000` (ARS 500,00) para un turno del paciente del seed `Paciente Ficticio Ejemplo` (plan `Plan Ficticio 100`, `cobertura_pct: 100`)
- **THEN** el sistema responde `201` con `cobertura_centavos: 50000`, `saldo_paciente_centavos: 0` y snapshot `cobertura_pct: 100`

#### Scenario: Cargo con ejemplo ficticio de FL-04

- **WHEN** `recepcion` registra `monto_total_centavos: 5000000` (ARS 50.000,00) con un plan ficticio de `cobertura_pct: 60`
- **THEN** el sistema responde `201` con `cobertura_centavos: 3000000` (ARS 30.000,00) y `saldo_paciente_centavos: 2000000` (ARS 20.000,00)

#### Scenario: Redondeo con truncamiento BigInt
- **WHEN** `recepcion` registra `monto_total_centavos: 333` con un plan ficticio de `cobertura_pct: 50`
- **THEN** el sistema calcula cobertura con división BigInt truncada y responde `201` con `cobertura_centavos: 166` y `saldo_paciente_centavos: 167` (Decisión Q1 aprobada)

#### Scenario: Paciente sin plan y sin plan declarado

- **WHEN** se registra una cobertura para un turno de un paciente sin `obra_social_plan_id` y sin `obra_social_plan_id` en el body
- **THEN** el sistema responde `400` y no persiste registro alguno

#### Scenario: Solo recepción/administración registran

- **WHEN** un usuario con rol `profesional` llama `POST /api/obras-sociales/coberturas` con un body válido
- **THEN** el sistema responde `403` y no persiste registro alguno

### Requirement: Registro explícito del cargo, sin acoplamiento con la agenda

El registro del cargo SHALL ser una operación explícita de `recepcion`/`administracion` con el importe declarado (`monto_total_centavos` del body). El sistema SHALL NO generar cargos automáticamente al confirmar, cancelar o reprogramar turnos, y SHALL NO alterar los flujos de reserva, confirmación o cancelación (C-04, C-05 y C-06 sin cambios).

#### Scenario: La confirmación del turno no genera cargo

- **WHEN** `recepcion` confirma un turno con prestación y plan asignado sin operar `POST /api/obras-sociales/coberturas`
- **THEN** no se crea fila en `obra_social_cobertura_turno` y el estado del turno queda sin cambios (el cargo existe solo si se registra explícitamente)

### Requirement: Porcentaje general del plan, sin nomenclador ni pct diferencial

El sistema SHALL usar exclusivamente el campo general `cobertura_pct` del plan, aplicado al importe declarado de la prestación del turno. SHALL NOT aceptar pct diferencial por tratamiento, grupo o nomenclador (No evidenciado; Open Question 7). El mismo pct SHALL producir la cobertura para cualquier monto del plan y queda como snapshot en el registro.

#### Scenario: El pct general se aplica a montos distintos del mismo plan

- **WHEN** `recepcion` registra dos cargos con `cobertura_pct: 60`, uno de `monto_total_centavos: 100000` y otro de `monto_total_centavos: 5000000`
- **THEN** ambas respuestas `201` usan el pct 60 del plan: `cobertura_centavos: 60000` y `3000000` respectivamente (el porcentaje no varía por tratamiento)

#### Scenario: Campo de pct por tratamiento o nomenclador rechazado

- **WHEN** el body de `POST /api/obras-sociales/coberturas` incluye un campo adicional como `cobertura_pct_tratamiento` o `codigo_nomenclador`
- **THEN** el sistema responde `400` sin persistir registro alguno (fuera de allowlist; el pct del plan es el único porcentaje usado)

### Requirement: Validaciones de entrada del cargo

El sistema SHALL rechazar con `400` sin persistir cuando el turno no existe/está de baja o no tiene `prestacion_id`; el plan declarado no existe/está de baja o difiere del asignado al paciente; el monto no es entero ≥ 0 exacto, o el resultado del cálculo excede `Number.MAX_SAFE_INTEGER`; o hay campos fuera de allowlist. Coherencia paciente–turno–plan obligatoria; casos límite: ver escenarios.

#### Scenario: Monto no entero rechazado

- **WHEN** `recepcion` envía `monto_total_centavos: 500.75`
- **THEN** el sistema responde `400` y no persiste registro alguno (R2: centavos enteros, nunca floats)

#### Scenario: Monto negativo rechazado

- **WHEN** `recepcion` envía `monto_total_centavos: -1`
- **THEN** el sistema responde `400` y no persiste registro alguno (R5: `monto_centavos >= 0`)

#### Scenario: Monto cero permitido

- **WHEN** `recepcion` envía `monto_total_centavos: 0` para un turno con plan vigente
- **THEN** el sistema responde `201` con `cobertura_centavos: 0`, `saldo_paciente_centavos: 0`

#### Scenario: Turno sin prestación rechazado

- **WHEN** se intenta registrar una cobertura para un turno con `prestacion_id` nulo
- **THEN** el sistema responde `400` y no persiste registro alguno (el cálculo RN-07 se aplica sobre la prestación del turno; sin esa prestación no se registra cobertura).

#### Scenario: Plan incompatible con el paciente rechazado

- **WHEN** la recepción declara un `obra_social_plan_id` distinto del plan asignado al paciente del turno
- **THEN** el sistema responde `400` y no persiste registro alguno

#### Scenario: Turno inexistente o eliminado

- **WHEN** se declara un `turno_id` inexistente o con `deleted_at` no nulo
- **THEN** el sistema responde `404` y no persiste registro alguno

#### Scenario: Resultado no convertible a `number` seguro rechazado

- **WHEN** `recepcion` envía `monto_total_centavos: 10000000000000000` (10^16, ficticio) para un plan con `cobertura_pct: 100`: la cobertura calculada excede `Number.MAX_SAFE_INTEGER`
- **THEN** el sistema responde `400` (`monto no representable`) y no persiste registro alguno (R2: nunca guardar un entero no exacto)

#### Scenario: Monto grande debajo del límite se calcula exacto

- **WHEN** `recepcion` registra `monto_total_centavos: 9000000000000000` (9·10^15, ficticio) con un plan `cobertura_pct: 50`
- **THEN** el sistema responde `201` con `cobertura_centavos: 4500000000000000` y `saldo_paciente_centavos: 4500000000000000` (exactos como `number`)

### Requirement: Invariancia financiera del registro

Todo registro de cobertura SHALL cumplir, garantizado por CHECKs de la migración 011 además del servicio: `cobertura_centavos >= 0`, `saldo_paciente_centavos = monto_total_centavos − cobertura_centavos`, `cobertura_centavos <= monto_total_centavos`, `cobertura_pct` entero 0..100 (R6) y `moneda = 'ARS'`.

#### Scenario: Invariante chequeado en la base

- **WHEN** se intenta insertar directamente una fila con `saldo_paciente_centavos` distinto de `monto_total_centavos − cobertura_centavos`
- **THEN** SQLite rechaza la escritura por el CHECK de la migración 011

#### Scenario: Porcentaje snapshot dentro de rango

- **WHEN** se registra una cobertura cuyo plan declara `cobertura_pct` válido
- **THEN** la fila persiste `cobertura_pct` igual al del plan al momento del registro (snapshot auditable)

### Requirement: Único cargo vigente por turno

El sistema SHALL impedir más de una cobertura vigente (`deleted_at` nulo) por el mismo `turno_id`: el intento duplicado SHALL responder `409` sin duplicar filas. La baja lógica SHALL exponerse como `DELETE /api/obras-sociales/coberturas/:id` (roles `recepcion` y `administracion`) dentro de una única transacción: si la cobertura está incluida en una liquidación vigente, SHALL responder `409` con la fila intacta y, si no, SHALL permitir la re-emisión del cargo (FL-04).

#### Scenario: Cargo duplicado rechazado

- **WHEN** se registra por segunda vez una cobertura vigente para el mismo `turno_id`
- **THEN** el sistema responde `409` y la base no contiene una segunda fila (modelo vigente [Comprobada en 003]: `turno.prestacion_id` es columna única sin multi-prestación, así que el cargo OS también es uno solo por turno; un soporte multi-prestación requeriría otro change)

#### Scenario: Cargo re-registrable tras baja lógica

- **WHEN** la cobertura vigente del turno se marca de baja lógica y luego se registra nuevamente
- **THEN** el sistema responde `201` con el nuevo registro calculado con los valores vigentes del momento

#### Scenario: Cobertura incluida en liquidación vigente no se da de baja

- **WHEN** `recepcion` ejecuta `DELETE` sobre una cobertura referenciada por un ítem de una liquidación vigente (borrador generado por API)
- **THEN** el sistema responde `409` y la fila conserva su vigencia y sus importes snapshot intactos

#### Scenario: Baja sin liquidación habilita re-emisión

- **WHEN** `recepcion` ejecuta `DELETE` sobre una cobertura que no participa en liquidación vigente alguna
- **THEN** el sistema responde `200`, marca solo `deleted_at` y conserva los importes snapshot de la fila de baja

#### Scenario: Registro concurrente sin duplicar

- **WHEN** dos solicitudes simultáneas registran una cobertura para el mismo turno sobre la base y las transacciones reales del proyecto (escenario 5.5.7, sin mocks)
- **THEN** las respuestas son una `201` y una `409` (en cualquier orden) y el turno queda con exactamente una fila de cobertura vigente, sin filas huérfanas

### Requirement: Actualización controlada del monto declarado

El sistema SHALL exponer `PATCH /api/obras-sociales/coberturas/:id` (roles `recepcion` y `administracion`) que acepta solo `monto_total_centavos` (entero ≥ 0); al editar SHALL recalcular `cobertura_centavos`, `saldo_paciente_centavos` y refrescar el snapshot `cobertura_pct` al valor vigente del plan. La operación SHALL revalidar el estado real dentro de la transacción (UnitOfWork): sobre una cobertura en liquidación vigente SHALL responder `409` y sin filas afectadas `404`.

#### Scenario: Monto corregido recalculado

- **WHEN** `recepcion` corrige el monto declarado de `50000` a `40000` en una cobertura no liquidada de un plan con `cobertura_pct: 50`
- **THEN** el sistema responde `200` con `cobertura_centavos: 20000`, `saldo_paciente_centavos: 20000`

#### Scenario: Cobertura ya incluida en liquidación es inmutable

- **WHEN** `recepcion` intenta `PATCH` sobre una cobertura cuya fila de liquidación vigente la referencia
- **THEN** el sistema responde `409` y los importes no cambian (trazabilidad del reintegro)

#### Scenario: Patch sobre cobertura dada de baja responde 404

- **WHEN** `recepcion` corrige el monto de una cobertura que ya fue dada de baja lógicamente
- **THEN** el sistema responde `404` y la fila de baja conserva sus importes y su porcentaje snapshot sin cambios

#### Scenario: Campo fuera de allowlist rechazado

- **WHEN** el body del `PATCH` incluye `cobertura_centavos` declarado a mano
- **THEN** el sistema responde `400` y no modifica ningún campo (solo el servicio calcula, RN-07)

### Requirement: Consulta de coberturas con RBAC

El sistema SHALL exponer `GET /api/obras-sociales/coberturas` (listado) y `GET /api/obras-sociales/coberturas/:id` (detalle) con alcance por rol: `recepcion` y `administracion` ven todos los cargos; `profesional` solo los de sus propios turnos (vínculo `usuario.profesional_id`). Sin token SHALL responder `401`. Las respuestas no SHALL incluir PHI del paciente (R3).

#### Scenario: Recepción consulta todas las coberturas

- **WHEN** un usuario con rol `recepcion` llama `GET /api/obras-sociales/coberturas`
- **THEN** el sistema responde `200` con las coberturas vigentes (las de baja lógica quedan excluidas) y ningún dato PHI

#### Scenario: Profesional limitado a turnos propios

- **WHEN** un usuario `profesional` con vínculo a `profesional_id` P1 solicita `GET /api/obras-sociales/coberturas/:id` de un cargo de un turno de P2
- **THEN** el sistema responde `403` y no expone importes

#### Scenario: Profesional consulta turno propio

- **WHEN** el mismo usuario `profesional` solicita el detalle de una cobertura de un turno propio
- **THEN** el sistema responde `200` con los importes del cargo y su saldo
