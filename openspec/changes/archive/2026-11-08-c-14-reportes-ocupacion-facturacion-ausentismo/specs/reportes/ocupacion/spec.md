# Spec Delta — reportes/ocupacion

## Purpose

Lectura agregada y **read-only** de minutos ocupados absolutos por período, granularidad y dimensión (profesional, sillón), calculada desde `turno.inicio`/`turno.fin`. Sin denominador de capacidad, sin grilla de slots y sin supuestos de horario de atención: el reporte informa cuánto tiempo estuvo turnado, no un porcentaje.

## ADDED Requirements

### Requirement: Minutos ocupados absolutos del período

El sistema SHALL exponer `GET /api/reportes/ocupacion` y devolver `total.minutos_ocupados` como la suma entera de `(turno.fin − turno.inicio)` en minutos de los turnos cuyo `turno.inicio` cae en el rango local `[desde, hasta]` y cuyo estado es `reservado`, `confirmado`, `presente` o `atendido`. SHALL excluir turnos con `deleted_at` no nulo. SHALL devolver además `total.turnos` con la cantidad de turnos contabilizados. NO SHALL emitir ningún porcentaje ni denominador de capacidad.

#### Scenario: Turnos activos del período suman minutos

- **GIVEN** tres turnos ficticios del mismo profesional con duraciones de 30, 90 y 60 minutos, todos con `inicio` dentro del rango y estados `confirmado`, `presente` y `atendido`
- **WHEN** `administracion` consulta `GET /api/reportes/ocupacion?desde=2026-11-01&hasta=2026-11-07`
- **THEN** el sistema responde `200` con `total.minutos_ocupados: 180` y `total.turnos: 3`

#### Scenario: Turnos cancelados no suman ocupación

- **GIVEN** un turno `cancelado` de 60 minutos y un turno `confirmado` de 30 minutos, ambos con `inicio` en el rango
- **WHEN** se consulta el reporte del período
- **THEN** `total.minutos_ocupados` es `30` y `total.turnos` es `1`

#### Scenario: Turnos ausentes no suman ocupación

- **GIVEN** un turno `ausente` de 45 minutos con `inicio` en el rango
- **WHEN** se consulta el reporte del período
- **THEN** el turno no aparece en `total` ni en `por_profesional` ni en `por_sillon`

#### Scenario: Turno con soft-delete excluido

- **GIVEN** un turno `atendido` de 60 minutos cuyo `deleted_at` no es nulo
- **WHEN** se consulta el reporte del período
- **THEN** `total.minutos_ocupados` no lo incluye

#### Scenario: Duración de la prestación no altera el cálculo

- **GIVEN** un turno de 40 minutos cuya `prestacion.duracion_min` es 30
- **WHEN** se consulta el reporte
- **THEN** el sistema contabiliza 40 minutos, derivados de `turno.inicio` y `turno.fin`, sin consultar la prestación

#### Scenario: Período sin turnos devuelve ceros

- **WHEN** se consulta un rango sin turnos
- **THEN** el sistema responde `200` con `total: { turnos: 0, minutos_ocupados: 0 }`, `series: []`, `por_profesional: []` y `por_sillon: []`

### Requirement: Agrupación por granularidad en zona horaria configurada

El sistema SHALL agrupar las métricas en `series` según `granularidad` con valores `dia`, `semana` o `mes`, usando `dia` cuando el parámetro se omite. Las claves SHALL ser `YYYY-MM-DD`, `YYYY-Www` (ISO-8601, lunes como primer día) y `YYYY-MM` respectivamente, derivadas del **día local** en `config.caja.zonaHoraria`. El sistema SHALL devolver el campo `zona_horaria` con la zona aplicada. Las claves SHALL ordenarse ascendente e incluir solo buckets con datos.

#### Scenario: Turno próximo a medianoche cae en el día local correcto

- **GIVEN** un turno con `inicio: "2026-11-02T02:30:00.000Z"` (23:30 del 1 de noviembre en `America/Buenos_Aires`) de 30 minutos
- **WHEN** se consulta `granularidad=dia` para el rango `2026-11-01`..`2026-11-01`
- **THEN** el turno se contabiliza en `series[0].clave: "2026-11-01"` y el 2 de noviembre queda en cero

#### Scenario: Rango que excluye el día local no incluye el turno

- **GIVEN** el mismo turno de `2026-11-02T02:30:00.000Z`
- **WHEN** se consulta `granularidad=dia` para el rango `2026-11-02`..`2026-11-02`
- **THEN** `total.turnos` es `0`

#### Scenario: Semana ISO cruza de año correctamente

- **GIVEN** turnos con `inicio` los días locales 2026-12-31 y 2027-01-01
- **WHEN** se consulta `granularidad=semana` para el rango que los contiene
- **THEN** ambos se agrupan bajo la clave `2026-W53` (misma semana ISO), no bajo claves distintas

#### Scenario: Granularidad mensual agrupa el mes completo

- **GIVEN** turnos en distintos días de noviembre de 2026
- **WHEN** se consulta `granularidad=mes` para el rango `2026-11-01`..`2026-11-30`
- **THEN** `series` contiene una única clave `"2026-11"` con la suma de todos los turnos

#### Scenario: Granularidad inválida rechazada

- **WHEN** se consulta con `granularidad=trimestre`
- **THEN** el sistema responde `400` con `code: "validacion"` y no ejecuta la consulta agregada

### Requirement: Desglose por profesional y por sillón

El sistema SHALL devolver `por_profesional` con un elemento por `profesional_id` que tenga turnos en el período (`profesional_id`, `turnos`, `minutos_ocupados`) y `por_sillon` con la misma forma sobre `sillon_id`. Los elementos SHALL ordenarse por `minutos_ocupados` descendente y SHALL contener solo identificadores opacos.

#### Scenario: Desglose por profesional y sillón

- **GIVEN** dos profesionales y dos sillones con turnos en el período
- **WHEN** se consulta el reporte sin filtros de dimensión
- **THEN** `por_profesional` tiene 2 elementos y `por_sillon` tiene 2 elementos, y la suma de `minutos_ocupados` de cada desglose coincide con `total.minutos_ocupados`

#### Scenario: Filtro por profesional acota el total y el desglose

- **GIVEN** turnos de dos profesionales en el período
- **WHEN** `administracion` consulta con `profesional_id=<profesional A>`
- **THEN** `total` solo contabiliza turnos del profesional A y `por_profesional` contiene únicamente ese profesional

#### Scenario: Filtro por sillón acota el total

- **WHEN** se consulta con `sillon_id=<sillón B>`
- **THEN** `total` solo contabiliza turnos del sillón B y `por_sillon` contiene únicamente ese sillón

### Requirement: Validación de rango

El sistema SHALL rechazar con `400` y `code: "validacion"` cualquier consulta cuyo `desde` o `hasta` no sea una fecha real en formato `YYYY-MM-DD`, cuyo `desde` sea posterior a `hasta`, o cuyo rango supere los 366 días inclusive.

#### Scenario: Formato de fecha inválido rechazado

- **WHEN** se consulta con `desde=01-11-2026`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Fecha inexistente rechazada

- **WHEN** se consulta con `desde=2026-02-31`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Rango invertido rechazado

- **WHEN** se consulta con `desde=2026-11-10&hasta=2026-11-01`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Rango mayor a 366 días rechazado

- **WHEN** se consulta con `desde=2025-11-01&hasta=2026-11-02`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Rango de 366 días aceptado

- **WHEN** se consulta con un rango de exactamente 366 días
- **THEN** el sistema responde `200`

### Requirement: Control de acceso por rol

El sistema SHALL exigir autenticación. Los roles `recepcion` y `administracion` SHALL ver el reporte global. El rol `profesional` SHALL ver únicamente sus propias métricas, forzando el filtro con el `profesional_id` vinculado a su usuario, y SHALL recibir `403` si solicita explícitamente otro `profesional_id`.

#### Scenario: Recepción consulta el reporte global

- **WHEN** un usuario con rol `recepcion` consulta sin filtros
- **THEN** el sistema responde `200` con las métricas de todos los profesionales

#### Scenario: Profesional consulta sin filtro y recibe solo lo propio

- **GIVEN** un usuario `profesional` vinculado a `usuario.profesional_id = A`
- **WHEN** consulta sin `profesional_id`
- **THEN** el sistema responde `200` con métricas exclusivas del profesional A

#### Scenario: Profesional solicitando otro profesional recibe 403

- **GIVEN** un usuario `profesional` vinculado a `usuario.profesional_id = A`
- **WHEN** consulta con `profesional_id=<profesional B>`
- **THEN** el sistema responde `403` con `code: "forbidden"`

#### Scenario: Profesional sin vínculo recibe 403

- **GIVEN** un usuario con rol `profesional` y `usuario.profesional_id` nulo
- **WHEN** consulta el reporte
- **THEN** el sistema responde `403` con `code: "forbidden"`

#### Scenario: Consulta sin autenticación rechazada

- **WHEN** se consulta sin token
- **THEN** el sistema responde `401`

### Requirement: Respuesta sin PHI

El sistema SHALL devolver únicamente identificadores opacos y agregados numéricos. NO SHALL incluir `paciente_id`, nombres, DNI, números de historia clínica ni `turno_id` individuales en el cuerpo, ni en mensajes de error, ni en logs.

#### Scenario: Cuerpo del reporte sin PHI

- **GIVEN** turnos de pacientes ficticios con nombre y DNI cargados
- **WHEN** se consulta el reporte
- **THEN** el cuerpo de la respuesta no contiene ningún nombre, DNI ni `paciente_id`

#### Scenario: Error de validación sin PHI

- **WHEN** se consulta con `profesional_id` inválido
- **THEN** el `400` devuelve solo `error` y `detalle` con el campo inválido, sin datos de pacientes
