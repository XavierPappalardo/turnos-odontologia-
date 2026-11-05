# caja/pagos Specification

## Purpose
Registra, consulta y gestiona el ciclo de vida de los pagos multimedio (efectivo, tarjeta, transferencia, Mercado Pago, obra social) aplicados a conceptos con fuente de precio declarada (presupuestos `aceptado` de C-10, con o sin turno) o como cobros directos sobre turnos, con validaciones financieras en centavos ARS, anulación con trazabilidad, idempotencia, pagos parciales, tope por concepto y consulta de deudas/saldos por turno y por paciente (C-11, KB-04 §8, KB-05 RN-07/RN-09, KB-06 F-07, KB-07 FL-04).

## Requirements

### Requirement: Registro de cobro con medio y aplicación

El sistema SHALL permitir registrar un cobro con medio del catálogo (`efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`), `monto_centavos` entero mayor a cero, moneda ARS, actor autenticado y una **aplicación** obligatoria: `presupuesto_id` (aplicado a un presupuesto `aceptado` vigente) o `turno_id` (cobro directo sobre un turno). Todo cobro válido queda en estado `cobrado` (o `pendiente` si es `mercadopago` hasta su confirmación) y genera un movimiento de caja trazable.

#### Scenario: Cobro válido en efectivo aplicado a presupuesto
- **WHEN** recepción aplica un cobro de 2000000 centavos con medio `efectivo` a un presupuesto `aceptado` del turno
- **THEN** el sistema responde `201`, persiste el pago en estado `cobrado` con moneda `ARS` y la aplicación registrada, y genera un movimiento de caja de tipo `cobro`

#### Scenario: Cobro válido con tarjeta
- **WHEN** recepción registra un cobro de 1500000 centavos con medio `tarjeta` con su aplicación declarada
- **THEN** el sistema responde `201`, el pago queda `cobrado` con medio `tarjeta` y el movimiento de caja registra ese medio y su aplicación

#### Scenario: Cobro por transferencia
- **WHEN** recepción registra un cobro de 800000 centavos con medio `transferencia` y los últimos 4 dígitos de la transferencia como referencia
- **THEN** el sistema responde `201`, el pago queda `cobrado` con medio `transferencia` y su referencia queda almacenada en el historial

#### Scenario: Cobro directo sobre turno sin presupuestos aceptado
- **WHEN** recepción registra un cobro con aplicación por `turno_id` de un turno que no tiene presupuestos `aceptado` vigentes
- **THEN** el sistema responde `201`, el cobro se registra como entrada de caja pura (ingreso real) y no genera ni inventa saldo por cobrar

#### Scenario: Profesional no registra cobros
- **WHEN** un usuario con rol `profesional` intenta registrar un cobro
- **THEN** el sistema responde `403` y no persiste el pago

#### Scenario: Cobro sin actor autenticado rechazado
- **WHEN** se intenta registrar un cobro sin sesión autenticada
- **THEN** el sistema responde `401` y no persiste el pago

### Requirement: Rechazo de importes inválidos

El sistema SHALL rechazar todo cobro con `monto_centavos` negativo, cero, no entero, fuera del rango representable o sin aplicación válida (`presupuesto_id` o `turno_id`; o turnos/presupuestos inexistentes). El importe se valida en centavos exactos, nunca en float (R2/R5).

#### Scenario: Importe negativo rechazado
- **WHEN** se intenta registrar un cobro con `monto_centavos` -5000
- **THEN** el sistema responde `400` y no persiste ningún pago ni movimiento

#### Scenario: Importe cero rechazado
- **WHEN** se intenta registrar un cobro con `monto_centavos` 0
- **THEN** el sistema responde `400` y no persiste el pago

#### Scenario: Importe no entero rechazado
- **WHEN** se intenta registrar un cobro con un valor no entero (p. ej., 10.5)
- **THEN** el sistema responde `400` y no persiste el pago

#### Scenario: Medio inválido rechazado
- **WHEN** se intenta registrar un cobro con medio `criptomoneda` (fuera del catálogo)
- **THEN** el sistema responde `400` y no persiste el pago

#### Scenario: Cobro sin aplicación rechazado
- **WHEN** se intenta registrar un cobro sin `turno_id` ni `presupuesto_id`
- **THEN** el sistema responde `400` y no persiste el pago

#### Scenario: Cobro sobre turno inexistente rechazado
- **WHEN** se intenta registrar un cobro con un `turno_id` que no existe
- **THEN** el sistema responde `400` y no persiste el pago

### Requirement: Aplicación única y tope por concepto

El sistema SHALL impedir contabilizar dos veces el mismo concepto: un cobro aplicado por `turno_id` a un turno con presupuestos `aceptado` vigentes se rechaza con `422 aplicacion_requerida`; la suma de cobros válidos de bolsillo aplicados a un presupuesto no supera su `saldo_centavos` vigente al momento del cobro (exceso → `422 monto_excede_saldo`); los pagos parciales están permitidos.

#### Scenario: Cobro parcial dentro del saldo del concepto
- **WHEN** un presupuesto `aceptado` tiene `saldo_centavos` 2000000 y se aplica un cobro de 800000
- **THEN** el sistema responde `201` y el saldo pendiente del concepto pasa a 1200000

#### Scenario: Cobro que agota el concepto en dos parciales
- **WHEN** sobre el mismo concepto se aplica un segundo cobro de 1200000 luego de uno de 800000
- **THEN** el sistema responde `201` y el saldo pendiente del concepto queda 0

#### Scenario: Cobro que excede el saldo del concepto rechazado
- **WHEN** un concepto tiene pendiente 1200000 y se intenta aplicar un cobro de 1500000
- **THEN** el sistema responde `422` con código `monto_excede_saldo` y no persiste el pago

#### Scenario: Cobro repetido del mismo importe cuando el concepto ya se cubrió rechazado
- **WHEN** un concepto de pendiente 2000000 ya recibió cobros válidos por 2000000 y se intenta aplicar otro cobro de 2000000
- **THEN** el sistema responde `422` con `monto_excede_saldo` y no se contabiliza una segunda vez

#### Scenario: Cobro por turno sin aplicación cuando existen presupuestos aceptado rechazado
- **WHEN** un turno tiene presupuestos `aceptado` vigentes y se intenta registrar un cobro aplicado solo por `turno_id`
- **THEN** el sistema responde `422` con código `aplicacion_requerida` y el concepto no queda contabilizado dos veces

### Requirement: Cobros a obra social diferenciados de la deuda del paciente

El sistema SHALL registrar los cobros con medio `obra_social` como ingreso real de caja, sin reducir el saldo pendiente del concepto para el paciente: la deuda ARS del concepto solo computa cobros de bolsillo. La cobertura es acumulativa: el nuevo cobro de `obra_social` se compara contra `cobertura_centavos` menos los cobros OS vigentes del concepto (una anulación devuelve lo usado), chequeando y registrando en la misma transacción; exceso → `422 cobro_os_excede_cobertura`.

#### Scenario: Cobro obra social ingresa a caja sin alterar deuda del paciente
- **WHEN** un concepto tiene `cobertura_centavos` 3000000 y `saldo_centavos` 2000000 (pendiente de bolsillo) y se aplica un cobro de `obra_social` por 3000000
- **THEN** el sistema responde `201`, el resumen por medio suma 3000000 a obra social, y la deuda ARS del paciente por ese concepto mantiene los 2000000

#### Scenario: Cobro obra social sin alterar deuda del paciente
- **WHEN** un concepto tiene deuda de bolsillo 2000000 y se aplica un cobro `obra_social`
- **THEN** la consulta de saldo del concepto y de deuda del paciente no se reduce por el cobro `obra_social`

#### Scenario: Cobro obra social que se ajusta a la cobertura restante
- **WHEN** un concepto tiene `cobertura_centavos` 30000, ya recibió cobros `obra_social` vigentes por 20000 y se aplica un nuevo cobro `obra_social` de 10000
- **THEN** el sistema responde `201` (queda dentro de la cobertura restante de 10000) y la deuda ARS del paciente por el concepto no cambia

#### Scenario: Cobro obra social que excede la cobertura restante rechazado
- **WHEN** un concepto tiene `cobertura_centavos` 30000, cobros `obra_social` vigentes por 20000 y se intenta aplicar otro cobro `obra_social` de 15000
- **THEN** el sistema responde `422` con código `cobro_os_excede_cobertura` y no persiste el pago

#### Scenario: Anulación de cobro obra social devuelve la cobertura
- **WHEN** sobre ese concepto se anula un cobro `obra_social` de 5000 (vigentes quedan en 15000) y luego se aplica un nuevo cobro `obra_social` de 10000
- **THEN** el sistema responde `201`: la anulación devolvió la parte usada (restante pasó de 10000 a 15000) y los cobros OS vigentes llegan a 25000 sin rechazo

### Requirement: Idempotencia de cobros

El sistema SHALL soportar una clave de idempotencia por cobro (única cuando se envía): reenviar la clave con datos idénticos (aplicación + medio + monto) devuelve el pago y su estado originales sin contabilizar doble; reenviarla con datos distintos se rechaza. Además, si el pago resultante quedó `anulado`, el reenvío devuelto expone el estado `anulado` con su trazabilidad (no revive el cobro).

#### Scenario: Reenvío idéntico no duplica el cobro
- **WHEN** se envía dos veces el mismo cobro con la misma `clave_idempotencia` y mismos datos
- **THEN** la segunda respuesta es idempotente (`200` con el pago original) y el saldo pendiente del concepto se computa una sola vez

#### Scenario: Reenvío con datos distintos rechazado
- **WHEN** se envía la misma `clave_idempotencia` con un monto distinto
- **THEN** el sistema responde `409` con código `idempotencia_conflictos` y no persiste un segundo pago

#### Scenario: Reenvío de cobro anulado no reactiva el cobro
- **WHEN** se reenvía la `clave_idempotencia` de un pago que ya fue `anulado`
- **THEN** la respuesta expone el pago `anulado` con su trazabilidad y no se crea un cobro vigente

#### Scenario: Cobros sin clave no generan colisiones
- **WHEN** se registran dos cobros distintos sin `clave_idempotencia` en el mismo concepto
- **THEN** el sistema persiste ambos pagos y ambos contabilizan (sujetos al tope por concepto)

### Requirement: Anulación de pago con trazabilidad

El sistema SHALL permitir anular un pago únicamente en estado `cobrado`, con actor autenticado autorizado (`recepcion` o `administracion`) y motivo obligatorio. La anulación sella el pago en `anulado` con actor, motivo y fecha, genera un movimiento de caja de tipo `anulacion` vinculado al pago y no elimina datos. Se ejecuta en una transacción que relee el estado vigente del pago antes de aplicarlo (resistente a carreras, bajo `BEGIN IMMEDIATE`).

#### Scenario: Anulación válida de pago cobrado
- **WHEN** `administracion` anula un pago `cobrado` con motivo "error de medio"
- **THEN** el sistema responde `200`, el pago queda `anulado` con actor, motivo y fecha, y se registra un movimiento de caja de tipo `anulacion` vinculado al pago

#### Scenario: Anulación de pago ya anulado rechazada
- **WHEN** se intenta anular un pago ya `anulado`
- **THEN** el sistema responde `409` con código `anulacion_inconsistente` y el estado permanece `anulado` sin segundo movimiento

#### Scenario: Anulación de pago pendiente rechazada
- **WHEN** se intenta anular un pago en estado `pendiente`
- **THEN** el sistema responde `409` y el estado permanece `pendiente`

#### Scenario: Profesional no anula pagos
- **WHEN** un usuario con rol `profesional` intenta anular un pago
- **THEN** el sistema responde `403` y el estado permanece `cobrado`

### Requirement: Históricos de pagos y anulados por turno y concepto

El sistema SHALL exponer el historial de pagos de un turno (cobros aplicados a conceptos de ese turno y cobros directos) y por concepto, incluyendo los anulados marcados con actor, motivo y fecha, ordenados por fecha. Los pagos `anulado` no computan en totales de caja.

#### Scenario: Historial incluye anulados marcados
- **WHEN** un concepto recibió un cobro de 800000 que fue anulado, y luego un cobro de 800000 cobrado
- **THEN** el historial muestra ambas entradas — cobrado (con actor y fecha) y anulado (con actor, motivo y fecha) — y el saldo pendiente del concepto refleja solo el cobro vigente

#### Scenario: Historial sin PHI en errores
- **WHEN** cualquier operación de caja devuelve error
- **THEN** el mensaje no expone nombres, DNI ni datos de pacientes (solo identificadores internos)

### Requirement: Consulta de saldo pendiente por turno

El sistema SHALL exponer el saldo pendiente de un turno en cuatro campos de centavos: `total_a_cobrar` (Σ `saldo_centavos` de los conceptos `aceptado` vigentes con ese `turno_id`), `saldo_restante` (Σ pendiente del concepto tras los cobros de bolsillo aplicados), `cobrado_ars` (todos los cobros válidos de bolsillo del turno, aplicados o directos) y `cobrado_obra_social` aparte. Los cobros anulados y los pagos `pendiente` no computan.

#### Scenario: Saldo refleja solo pagos válidos
- **WHEN** un turno con concepto de saldo 2000000 tiene un cobro de bolsillo anulado de 1000000 y uno vigente de 500000
- **THEN** la consulta responde `200` con `cobrado_ars` 500000 y `saldo_restante` 1500000, sin computar el anulado

#### Scenario: Saldo por turno con concepto cubierto y cobro directo
- **WHEN** un turno tiene concepto de saldo 2000000 totalmente cubierto y además un cobro directo de 500000 (turno sin cobros adicionales)
- **THEN** la consulta responde `200` con `saldo_restante` 0 y `cobrado_ars` 2500000

#### Scenario: Turno sin presupuestos aceptado no inventa saldo
- **WHEN** se consulta el saldo de un turno sin presupuestos `aceptado` con un cobro directo de 500000
- **THEN** la consulta responde `200` con `total_a_cobrar` 0, `saldo_restante` 0 y `cobrado_ars` 500000

#### Scenario: Pago pendiente no computa en saldo
- **WHEN** un turno tiene un pago `pendiente` de 800000 y un concepto `aceptado` de 2000000, y se consulta el saldo
- **THEN** `cobrado_ars` es 0 y `saldo_restante` es 2000000

#### Scenario: Recepción consulta saldo de su turno
- **WHEN** `recepcion` consulta el saldo de un turno (cobros gestionados por recepción)
- **THEN** el sistema responde `200` con los campos de saldo desglosados en centavos

#### Scenario: Profesional no consulta saldo de caja
- **WHEN** un `profesional` consulta el saldo de caja de un turno
- **THEN** el sistema responde `403` (R4: dominio de caja global solo recepción/administración)

### Requirement: Consulta de deuda pendiente por paciente

El sistema SHALL exponer la deuda pendiente de un paciente como la suma de deuda por concepto (de bolsillo) de TODOS sus conceptos (presupuestos) `aceptado` vigentes: los turnos de cada presupuesto y los presupuestos sin `turno_id`, cada uno contabilizado exactamente una vez (los cobros aplicados al concepto se descuentan del concepto; nunca se reimputan). Los cobros `obra_social` no reducen esta deuda.

#### Scenario: Deuda por paciente incluye presupuestos sin turno
- **WHEN** un paciente tiene un presupuesto `aceptado` sin turno por 3000000 y una deuda en un turno por 2000000, sin cobros aplicados
- **THEN** la consulta responde `200` con deuda total 5000000, listando ambos conceptos desagregados

#### Scenario: Concepto con turno no se cuenta dos veces en el paciente
- **WHEN** un paciente tiene un concepto `aceptado` con `turno_id` T de saldo 2000000 y se consulta su deuda global después de aplicar un cobro de bolsillo de 800000 a T
- **THEN** la deuda responde `200` igual a 1200000 — el concepto aparece una sola vez y su cobro aplicado se descuenta una vez

#### Scenario: Anulado no computa en deuda
- **WHEN** sobre un concepto de un paciente se anula un cobro de bolsillo de 500000 que había sido cobrado
- **THEN** la deuda del paciente vuelve a aumentar en 500000 respecto de lo que mostraba tras el cobro

#### Scenario: Diferencia entre deuda del paciente y cobrado a obra social
- **WHEN** un paciente con concepto `aceptado` (cobertura 3000000, saldo 2000000) tiene aplicado un cobro `obra_social` de 3000000 y ningún cobro de bolsillo
- **THEN** la deuda del paciente responde 2000000 y el campo separado `cobrado_obra_social` responde 3000000 — ambas cifras coexisten sin mezclarse

#### Scenario: Paciente sin deuda
- **WHEN** un paciente sin conceptos `aceptado` vigentes consulta su deuda
- **THEN** la consulta responde `200` con deuda total 0

### Requirement: Migración 010 de caja y extensión de pago (rebuild preservado)

El sistema SHALL aplicar una migración `010` nueva sin modificar 001–009: recompone `pago` preservando sus datos previos (con `turno_id` nullable, `presupuesto_id` FK, CHECK de aplicación obligatoria — pago con turno o presupuesto — y `clave_idempotencia` única parcial), crea `movimiento_caja` append-only con `fecha_contable`, `aplicado_en` y `motivo_asignacion`, y crea `cierre_caja` como snapshot único por fecha contable; en ambas, FKs, CHECKs de montos e índices de consulta.

#### Scenario: Esquema tras migración 010
- **WHEN** se abre una base con migraciones 001→010
- **THEN** existen la tabla `pago` recompuesta con el CHECK de aplicación, `movimiento_caja` y `cierre_caja` con sus FKs/CHECKs/índices

#### Scenario: Datos previos de pago preservados
- **WHEN** una base con pagos previos de migraciones anteriores aplica la migración 010
- **THEN** todos los pagos previos conservan `id`, `turno_id`, montos, medios, estados y auditoría, y quedan consultables por la capa nueva (cada pago previo queda con su `turno_id` original y `presupuesto_id` NULL)

#### Scenario: Migración 010 idempotente
- **WHEN** el runner de migraciones corre dos veces sobre la misma base
- **THEN** la segunda corrida no aplica `010` de nuevo y los datos permanecen

#### Scenario: CHECK de aplicación obligatorio en pago
- **WHEN** se intenta insertar un pago sin `turno_id` y sin `presupuesto_id`
- **THEN** la base rechaza la inserción por el CHECK de aplicación

#### Scenario: Integridad de clave de idempotencia
- **WHEN** se intenta insertar dos pagos vigentes con la misma `clave_idempotencia` no nula
- **THEN** la base rechaza la segunda inserción por la unicidad declarada
