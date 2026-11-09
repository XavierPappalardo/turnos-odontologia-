# reportes/ausentismo Specification

## Purpose
Lectura agregada y **read-only** de ausentismo: proporción de turnos en estado `ausente` sobre los turnos resueltos (`atendido` + `ausente`) de un período. No incluye cancelaciones —anticipadas o tardías— porque el modelo no persiste el instante de cancelación ni un estado de cancelación tardía, y este change no introduce migraciones.

## Requirements

### Requirement: Conteo de ausentes y turnos resueltos

El sistema SHALL exponer `GET /api/reportes/ausentismo` y devolver `total.ausentes` como la cantidad de turnos con `estado = 'ausente'` cuyo `turno.inicio` cae en el rango local `[desde, hasta]`, y `total.resueltos` como la cantidad de turnos con `estado` en `atendido` o `ausente` en ese mismo rango. SHALL excluir turnos con `deleted_at` no nulo.

#### Scenario: Ausentes sobre resueltos en el período

- **GIVEN** turnos ficticios con `inicio` en el rango: 8 `atendido` y 2 `ausente`
- **WHEN** `administracion` consulta `GET /api/reportes/ausentismo?desde=2026-11-01&hasta=2026-11-07`
- **THEN** el sistema responde `200` con `total.ausentes: 2`, `total.resueltos: 10` y `total.tasa_ausentismo_pct: 20`

#### Scenario: Turnos aún abiertos no entran en el denominador

- **GIVEN** 3 turnos `atendido`, 1 `ausente`, 5 `confirmado` y 2 `reservado`, todos con `inicio` en el rango
- **WHEN** se consulta el reporte
- **THEN** `total.resueltos` es `4` y `total.ausentes` es `1`, sin contabilizar los turnos abiertos

#### Scenario: Cancelados no entran en numerador ni denominador

- **GIVEN** 2 turnos `cancelado` y 1 `atendido` con `inicio` en el rango
- **WHEN** se consulta el reporte
- **THEN** `total.ausentes` es `0` y `total.resueltos` es `1`

#### Scenario: Turno con soft-delete excluido

- **GIVEN** un turno `ausente` con `deleted_at` no nulo
- **WHEN** se consulta el reporte
- **THEN** no se contabiliza en `ausentes` ni en `resueltos`

#### Scenario: Período sin turnos resueltos devuelve tasa nula

- **WHEN** se consulta un rango sin turnos resueltos
- **THEN** el sistema responde `200` con `total: { ausentes: 0, resueltos: 0, tasa_ausentismo_pct: null }` y `series: []`

### Requirement: Tasa de ausentismo entera y determinista

El sistema SHALL calcular `tasa_ausentismo_pct` como un entero 0..100 derivado en memoria mediante `ausentes * 100 / resueltos` con redondeo **half-up**. La tasa NO SHALL persistirse ni devolverse como decimal. Cuando `resueltos` sea `0`, la tasa SHALL ser `null`.

#### Scenario: Redondeo half-up hacia arriba

- **GIVEN** 1 turno `ausente` y 7 `atendido` (1 de 8 = 12,5 %)
- **WHEN** se consulta el reporte
- **THEN** `tasa_ausentismo_pct` es `13`

#### Scenario: Redondeo half-up hacia abajo

- **GIVEN** 1 turno `ausente` y 15 `atendido` (1 de 16 = 6,25 %)
- **WHEN** se consulta el reporte
- **THEN** `tasa_ausentismo_pct` es `6`

#### Scenario: Cien por ciento de ausencias

- **GIVEN** 3 turnos `ausente` y 0 `atendido`
- **WHEN** se consulta el reporte
- **THEN** `tasa_ausentismo_pct` es `100`

#### Scenario: Cero por ciento de ausencias

- **GIVEN** 4 turnos `atendido` y 0 `ausente`
- **WHEN** se consulta el reporte
- **THEN** `tasa_ausentismo_pct` es `0`

### Requirement: Agrupación por granularidad en zona horaria local

El sistema SHALL agrupar los conteos en `series` según `granularidad` (`dia`, `semana`, `mes`, default `dia`), con claves `YYYY-MM-DD`, `YYYY-Www` (ISO-8601, lunes primero) y `YYYY-MM`, derivadas del **día local** en `config.caja.zonaHoraria`. Cada elemento SHALL incluir `clave`, `ausentes`, `resueltos` y `tasa_ausentismo_pct`.

#### Scenario: Serie diaria con tasas por bucket

- **GIVEN** el 2026-11-01: 1 `ausente` y 9 `atendido`; el 2026-11-02: 1 `ausente` y 1 `atendido`
- **WHEN** se consulta `granularidad=dia` para ese rango
- **THEN** `series` devuelve `{ clave: "2026-11-01", ausentes: 1, resueltos: 10, tasa_ausentismo_pct: 10 }` y `{ clave: "2026-11-02", ausentes: 1, resueltos: 2, tasa_ausentismo_pct: 50 }`

#### Scenario: Bucket sin resueltos devuelve tasa nula

- **GIVEN** un día del rango con solo turnos `cancelado`
- **WHEN** se consulta `granularidad=dia`
- **THEN** ese día no aparece en `series` (no hay datos que reportar)

#### Scenario: Turno próximo a medianoche se agrupa en el día local

- **GIVEN** un turno `ausente` con `inicio: "2026-11-02T02:30:00.000Z"` (23:30 del 1 de noviembre en `America/Buenos_Aires`)
- **WHEN** se consulta `granularidad=dia` para el rango `2026-11-01`..`2026-11-01`
- **THEN** el ausente se cuenta en la clave `"2026-11-01"`

### Requirement: Desglose por profesional

El sistema SHALL devolver `por_profesional` con un elemento por `profesional_id` que tenga turnos resueltos en el período, con los campos `profesional_id`, `ausentes`, `resueltos` y `tasa_ausentismo_pct`, calculada con la misma regla de redondeo y de `null` cuando `resueltos = 0`.

#### Scenario: Desglose por profesional

- **GIVEN** el profesional A con 2 `ausente` y 18 `atendido`, y el profesional B con 0 `ausente` y 5 `atendido`, en el rango
- **WHEN** se consulta el reporte sin filtro
- **THEN** `por_profesional` incluye A con `tasa_ausentismo_pct: 10` y B con `tasa_ausentismo_pct: 0`

### Requirement: Control de acceso por rol

El sistema SHALL exigir autenticación. Los roles `recepcion` y `administracion` SHALL ver el reporte global. El rol `profesional` SHALL ver únicamente sus propias métricas y SHALL recibir `403` si solicita otro `profesional_id`.

#### Scenario: Recepción consulta ausentismo global

- **WHEN** un usuario con rol `recepcion` consulta sin filtros
- **THEN** el sistema responde `200` con las métricas de todos los profesionales

#### Scenario: Profesional consulta solo lo propio

- **GIVEN** un usuario `profesional` vinculado a `usuario.profesional_id = A`
- **WHEN** consulta sin `profesional_id`
- **THEN** el sistema responde `200` con métricas exclusivas del profesional A

#### Scenario: Profesional solicitando otro profesional recibe 403

- **WHEN** un usuario `profesional` consulta con `profesional_id` distinto al propio
- **THEN** el sistema responde `403` con `code: "forbidden"`

#### Scenario: Consulta sin autenticación rechazada

- **WHEN** se consulta sin token
- **THEN** el sistema responde `401`

### Requirement: Validación de rango y sin PHI

El sistema SHALL aplicar las mismas reglas de rango que `reportes/ocupacion` (fecha `YYYY-MM-DD` real, `desde <= hasta`, máximo 366 días) y SHALL devolver únicamente agregados e identificadores de profesional, sin datos de pacientes.

#### Scenario: Rango invertido rechazado

- **WHEN** se consulta con `desde=2026-11-10&hasta=2026-11-01`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Respuesta sin PHI

- **WHEN** se consulta el reporte con turnos de pacientes ficticios
- **THEN** el cuerpo no contiene nombres, DNI, `paciente_id` ni `turno_id`
