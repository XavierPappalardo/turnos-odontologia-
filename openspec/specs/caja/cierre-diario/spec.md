# caja/cierre-diario Specification

## Purpose
Ejecuta y consulta el cierre diario de caja con trazabilidad completa de cobros, ingresos por medio y anulaciones (RN-09): la fecha contable se calcula con la zona horaria IANA configurada para la clínica (los timestamps se almacenan en UTC; la fecha de negocio nunca deriva de UTC ni de desplazamientos fijos), un rol autorizado cierra la caja como máximo una vez por día, el cierre es un snapshot histórico inmutable, y los movimientos registrados después de un cierre se asignan con trazabilidad a la siguiente caja abierta sin alterar el snapshot (C-11, KB-05 §RN-09, KB-07 FL-04).

## Requirements

### Requirement: Fecha contable por zona horaria configurada

El sistema SHALL calcular la fecha contable de cada movimiento y cierre usando la zona horaria IANA configurada (`CAJA_ZONA_HORARIA`) vía Intl, sin usar la fecha UTC como fecha de negocio ni desplazamientos fijos; los timestamps de auditoría permanecen en ISO-8601 UTC. La zona se valida construyendo un `Intl.DateTimeFormat` con la zona recibida y capturando el error: una zona inexistente produce `ConfigError`; los alias IANA válidos se aceptan aunque no figuren en `Intl.supportedValuesOf`.

#### Scenario: Movimiento próximo a la medianoche cae en el día local correcto
- **WHEN** llega un pago a las 02:30 UTC con la zona configurada `America/Argentina/Buenos_Aires` (UTC-3)
- **THEN** el movimiento queda asignado a la fecha contable del día anterior al UTC (2026-06-30 23:30 locales → fecha de caja `2026-06-30`, no `2026-07-01`)

#### Scenario: Movimiento con zona de offset positivo avanza a día local mayor
- **WHEN** llega un pago a las 20:30 UTC con la zona configurada `Asia/Kathmandu` (UTC+05:45)
- **THEN** el movimiento queda asignado a la fecha contable del día local siguiente al UTC (20:30 UTC = 02:15 del día siguiente locales → fecha de caja del día siguiente), calculada con la zona configurada

#### Scenario: Zona horaria inválida rechazada al arranque
- **WHEN** la configuración define `CAJA_ZONA_HORARIA=Zona/Inexistente`
- **THEN** la carga de configuración falla con `ConfigError` que nombra la variable y la aplicación no arranca

#### Scenario: Alias IANA válido aceptado
- **WHEN** la configuración define `CAJA_ZONA_HORARIA=America/Argentina/Buenos_Aires` (alias válido que no figura literalmente en `Intl.supportedValuesOf`)
- **THEN** la configuración no produce `ConfigError` y la fecha contable se calcula correctamente con esa zona

#### Scenario: Configuración predeterminada arranca sin error
- **WHEN** `CAJA_ZONA_HORARIA` no está definida en el entorno
- **THEN** se usa el valor por defecto documentado en `.env.example` (`America/Buenos_Aires`), la aplicación arranca sin `ConfigError` y la fecha contable se calcula con esa zona

### Requirement: Cierre diario por rol autorizado

El sistema SHALL permitir cerrar la caja del día únicamente a usuarios con rol `administracion`, autenticados. El cierre genera un snapshot con la fecha contable del día, la zona horaria usada para calcularla, el actor que lo ejecuta, la fecha y hora de cierre (UTC) y los totales del día calculados sobre movimientos válidos.

#### Scenario: Cierre diario exitoso
- **WHEN** `administracion` cierra la caja del día con los totales calculados
- **THEN** el sistema responde `201`, persiste el cierre con fecha contable, zona horaria, actor, `cerrado_en` y totales del día en centavos (R2/R5)

#### Scenario: Usuario sin permisos intentando cerrar caja
- **WHEN** un usuario con rol `profesional` intenta cerrar la caja del día
- **THEN** el sistema responde `403` y no se persiste ningún cierre

#### Scenario: Recepción no cierra caja
- **WHEN** un usuario con rol `recepcion` intenta cerrar la caja del día
- **THEN** el sistema responde `403` y no se persiste ningún cierre

#### Scenario: Cierre exige autenticación
- **WHEN** se intenta cerrar la caja sin sesión autenticada
- **THEN** el sistema responde `401` y no se persiste ningún cierre

### Requirement: Un cierre por día contable

El sistema SHALL rechazar cualquier segundo cierre para una misma fecha contable, aunque cambie el actor. La unicidad `UNIQUE(fecha)` se aplica a nivel de base y se refuerza en el servicio mediante check-then-insert dentro de `UnitOfWork` (`BEGIN IMMEDIATE`).

#### Scenario: Segundo cierre del mismo día rechazado
- **WHEN** la caja del día ya está cerrada y `administracion` intenta cerrarla otra vez
- **THEN** el sistema responde `409` con código `cierre_duplicado` y no se persiste un segundo cierre para esa fecha

#### Scenario: Distinto actor tampoco duplica cierre
- **WHEN** la caja del día está cerrada y un usuario `administracion` distinto intenta cerrarla
- **THEN** el sistema responde `409` y no se persiste un segundo cierre

### Requirement: Snapshot histórico inmutable

El sistema SHALL conservar el snapshot de cada cierre sin permitir modificación retroactiva: no existen operaciones de edición/borrado de cierres, y los datos de un día cerrado quedan congelados tal como estaban al momento del cierre (totales calculados solo sobre movimientos con `aplicado_en` = fecha del cierre).

#### Scenario: Cierre no modificable retroactivamente
- **WHEN** se intenta editar o eliminar un cierre ya persistido por cualquier vía del API
- **THEN** el sistema no expone tal operación y cualquier intento responde `404` (método no soportado)

#### Scenario: Los cobros posteriores no alteran un día cerrado
- **WHEN** tras cerrar la caja del día se registra un pago y se vuelve a consultar el cierre
- **THEN** el cierre conserva sus totales originales congelados y no incorpora el movimiento nuevo

#### Scenario: Totales del snapshot calculados solo sobre movimientos asignados al día
- **WHEN** existen movimientos con `aplicado_en` en otras fechas contables y se consulta el snapshot de un día
- **THEN** el snapshot solo computa los movimientos cuyo `aplicado_en` coincida con esa fecha contable

### Requirement: Asignación de movimientos posteriores al cierre

El sistema SHALL gestionar los movimientos registrados después de un cierre sin modificar el snapshot previo: si la fecha contable del movimiento ya está cerrada, el movimiento se asigna en la misma transacción del cobro a la primera caja abierta posterior, conservando su `fecha_contable` original y registrando actor, fecha UTC y motivo `fecha_ya_cerrada`; si no existe caja abierta posterior, el cobro se rechaza sin persistir. Los ajustes manuales quedan fuera de C-11.

#### Scenario: Cobro con fecha contable ya cerrada se asigna a la caja abierta siguiente
- **WHEN** la caja del día D está cerrada y se registra un cobro cuya fecha contable es D (p. ej., carga retrasada o desfase de cierre)
- **THEN** el movimiento persiste con `fecha_contable` D, `aplicado_en` = primera caja abierta posterior (D+1), `motivo_asignacion = 'fecha_ya_cerrada'`, actor y fecha de asignación (UTC), y el snapshot de D permanece intacto

#### Scenario: Sin caja abierta posterior el cobro se rechaza sin persistir
- **WHEN** se intenta registrar un cobro cuya fecha contable D ya está cerrada y no existe ninguna caja abierta posterior disponible para asignar el movimiento
- **THEN** el sistema responde `409` con código `sin_caja_abierta_asignacion` y descarta la transacción completa del cobro (sin pago ni movimiento persistidos), hasta que exista una caja abierta donde asignarlo

#### Scenario: Cobro normal posterior al cierre no requiere asignación
- **WHEN** la caja del día D está cerrada y se registra un cobro con fecha contable D+1 (día abierto)
- **THEN** el movimiento queda con `aplicado_en` = fecha contable propia, sin motivo de asignación

#### Scenario: El resumen y los cierres computan por fecha asignada
- **WHEN** un movimiento fue asignado de D a D+1 y se consulta el resumen por medio de ambos días
- **THEN** el resumen de D no lo computa y el resumen de D+1 lo incluye

#### Scenario: Asignación trazable en el movimiento
- **WHEN** se lista el historial de movimientos de caja
- **THEN** cada movimiento con asignación muestra actor, `fecha_contable` original, `aplicado_en`, motivo `fecha_ya_cerrada` y fecha de asignación (UTC)

### Requirement: Resumen de ingresos por medio de pago

El sistema SHALL exponer el resumen de movimientos de caja de una fecha contable con el desglose de ingresos por medio (`efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`), el ingreso de bolsillo (`cobrado_ars`) separado del cobrado a obra social, y el monto de anulaciones, calculado siempre sobre pagos válidos (excluye `anulado` y `pendiente`).

#### Scenario: Resumen por medio en un día abierto
- **WHEN** en el día hay cobros válidos de 1000000 en `efectivo`, 800000 en `tarjeta`, 3000000 en `obra_social` y una anulación de 200000 sobre un pago `tarjeta`
- **THEN** el resumen muestra `efectivo` 1000000 y `tarjeta` 600000 (el anulado no computa), con `obra_social` 3000000 separado y la anulación de 200000 listada aparte

#### Scenario: Día sin movimientos
- **WHEN** se consulta el resumen de una fecha contable sin cobros ni anulaciones
- **THEN** el resumen responde `200` con todos los medios en 0 y anulaciones 0

#### Scenario: Profesional no consulta resumen de caja
- **WHEN** un `profesional` consulta el resumen de ingresos por medio del día
- **THEN** el sistema responde `403`

### Requirement: Historial de cierres

El sistema SHALL exponer el historial de cierres de caja (fechas contables cerradas, zona horaria, actor, totales al cierre) en orden descendente, sin incluir fechas no cerradas.

#### Scenario: Historial lista fechas cerradas
- **WHEN** existen cierres de dos fechas contables distintas y se consulta el historial
- **THEN** el sistema responde `200` con ambos cierres ordenados del más reciente al más antiguo, con fecha contable, zona, actor y totales

#### Scenario: Fecha abierta no aparece en historial
- **WHEN** una fecha contable con movimientos sin cierre se consulta en el historial
- **THEN** el sistema no la lista como cerrada

### Requirement: Trazabilidad insert-only de movimientos

El sistema SHALL registrar cada movimiento de caja (cobro o anulación) como evento insert-only vinculado al pago, al actor autenticado y a su fecha, conservando el orden temporal; `movimiento_caja` no admite UPDATE ni DELETE (ni por repositorio (R8) ni en base).

#### Scenario: Movimientos conservan trazabilidad
- **WHEN** en una fecha contable se registran cobro, pago parcial y una anulación, y se listan los movimientos
- **THEN** el listado muestra los tres eventos en orden con actor, tipo, montos y fechas, y el movimiento de la anulación referencia al pago anulado

#### Scenario: Movimiento de caja inmutable en base
- **WHEN** se intenta ejecutar UPDATE o DELETE sobre `movimiento_caja` directamente en la base
- **THEN** SQLite aborta la operación por trigger insert-only
