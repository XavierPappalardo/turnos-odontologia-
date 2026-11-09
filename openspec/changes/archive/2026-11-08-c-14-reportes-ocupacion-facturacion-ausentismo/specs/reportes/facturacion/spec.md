# Spec Delta — reportes/facturacion

## Purpose

Lectura agregada y **read-only** de facturación **percibida**: ingresos que efectivamente impactaron la caja, calculados desde `movimiento_caja` y agrupados por `aplicado_en`. Extiende multi-día la semántica de `GET /caja/resumen` para que el reporte nunca diverja del cierre diario. La facturación devengada queda fuera porque `prestacion` no tiene precio y C-15 está pendiente.

## ADDED Requirements

### Requirement: Ingresos netos por fecha de aplicación

El sistema SHALL exponer `GET /api/reportes/facturacion` y calcular `total.ingresos_netos_centavos` como la suma de `movimiento_caja.monto_centavos` con `tipo = 'cobro'` menos la suma de `movimiento_caja.monto_centavos` con `tipo = 'anulacion'`, filtrando por `movimiento_caja.aplicado_en` dentro de `[desde, hasta]`. SHALL devolver además `total.cobros.{cantidad,centavos}` y `total.anulaciones.{cantidad,centavos}`. Todos los montos SHALL ser enteros en centavos.

#### Scenario: Cobros netos del período

- **GIVEN** dos movimientos de caja ficticios con `aplicado_en` en el rango: un `cobro` de 50000 centavos y una `anulacion` de 20000 centavos
- **WHEN** `administracion` consulta `GET /api/reportes/facturacion?desde=2026-11-01&hasta=2026-11-07`
- **THEN** el sistema responde `200` con `ingresos_netos_centavos: 30000`, `cobros: { cantidad: 1, centavos: 50000 }` y `anulaciones: { cantidad: 1, centavos: 20000 }`

#### Scenario: Anulación posterior reduce el neto del día aplicado

- **GIVEN** un cobro aplicado el 2026-11-03 y una anulación del mismo pago aplicada el 2026-11-04
- **WHEN** se consulta el rango `2026-11-03`..`2026-11-04`
- **THEN** `series` muestra el cobro el 2026-11-03 y el neto reducido el 2026-11-04, y el `total` del rango refleja la resta

#### Scenario: Período sin movimientos devuelve ceros

- **WHEN** se consulta un rango sin movimientos de caja
- **THEN** el sistema responde `200` con `ingresos_netos_centavos: 0`, `cobros: { cantidad: 0, centavos: 0 }`, `anulaciones: { cantidad: 0, centavos: 0 }`, `series: []` y `por_medio` con los cinco medios en `0`

#### Scenario: Montos grandes no pierden precisión

- **GIVEN** movimientos ficticios que totalizan `9007199254740991` centavos
- **WHEN** se consulta el reporte
- **THEN** el total se devuelve exacto, sin conversión a punto flotante

### Requirement: Corte por `aplicado_en` y no por `fecha_contable`

El sistema SHALL asignar cada movimiento a su día según `movimiento_caja.aplicado_en`. Los movimientos con `motivo_asignacion = 'fecha_ya_cerrada'` SHALL contabilizarse en la fecha en que impactan la caja, no en la fecha contable del servicio.

#### Scenario: Cobro asignado a un día posterior computa en el día de aplicación

- **GIVEN** un cobro con `fecha_contable: "2026-11-03"`, `aplicado_en: "2026-11-04"` y `motivo_asignacion: "fecha_ya_cerrada"`
- **WHEN** se consulta `granularidad=dia` para el rango `2026-11-03`..`2026-11-04`
- **THEN** el movimiento aparece únicamente en la clave `"2026-11-04"` y no en `"2026-11-03"`

#### Scenario: Reporte conciliable con el cierre diario

- **GIVEN** un día cerrado con `cierre_caja` cuyo total por medio es X
- **WHEN** se consulta el reporte de ese mismo `aplicado_en`
- **THEN** el neto por medio coincide exactamente con X

### Requirement: Desglose por medio de pago y separación bolsillo/obra social

El sistema SHALL devolver `por_medio` con los cinco valores del dominio (`efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`), en centavos netos de anulaciones, obteniendo el medio mediante la unión `movimiento_caja.pago_id → pago.id`. SHALL devolver `total.bolsillo_centavos` como la suma de los cuatro medios distintos de `obra_social` y `total.obra_social_centavos` como el neto del medio `obra_social`.

#### Scenario: Desglose por medio con neteo

- **GIVEN** movimientos ficticios: cobro efectivo 10000, cobro tarjeta 20000, cobro obra_social 15000 y anulación de tarjeta 5000
- **WHEN** se consulta el reporte
- **THEN** `por_medio` devuelve `efectivo: 10000`, `tarjeta: 15000`, `transferencia: 0`, `mercadopago: 0`, `obra_social: 15000`

#### Scenario: Bolsillo y obra social no se mezclan

- **GIVEN** el caso anterior
- **WHEN** se consulta el reporte
- **THEN** `bolsillo_centavos` es `25000` y `obra_social_centavos` es `15000`, y su suma coincide con `ingresos_netos_centavos`

#### Scenario: Filtro por medio acota el total

- **WHEN** se consulta con `medio=obra_social`
- **THEN** `total.ingresos_netos_centavos` y `por_medio` solo contabilizan movimientos de ese medio

#### Scenario: Medio inválido rechazado

- **WHEN** se consulta con `medio=cheque`
- **THEN** el sistema responde `400` con `code: "validacion"`

### Requirement: Agrupación por granularidad

El sistema SHALL agrupar los ingresos netos en `series` según `granularidad` (`dia`, `semana`, `mes`, default `dia`) con claves `YYYY-MM-DD`, `YYYY-Www` (ISO-8601) y `YYYY-MM`, derivadas de `aplicado_en`, que ya es una fecha local `YYYY-MM-DD`. Las claves SHALL incluirse solo cuando tengan movimientos y ordenarse ascendente.

#### Scenario: Agrupación mensual

- **GIVEN** movimientos aplicados en distintos días de noviembre de 2026
- **WHEN** se consulta `granularidad=mes` para el rango `2026-11-01`..`2026-11-30`
- **THEN** `series` contiene una única clave `"2026-11"` con el neto del mes

#### Scenario: Agrupación semanal ISO

- **WHEN** se consulta `granularidad=semana` para un rango que incluye el 2026-11-02 (lunes)
- **THEN** la clave correspondiente es `"2026-W45"` en formato `YYYY-Www`

### Requirement: Acceso restringido a administración

El sistema SHALL exigir autenticación y SHALL permitir `GET /api/reportes/facturacion` únicamente al rol `administracion`. Los roles `recepcion` y `profesional` SHALL recibir `403` con `code: "forbidden"`.

#### Scenario: Administración consulta facturación

- **WHEN** un usuario con rol `administracion` consulta el reporte
- **THEN** el sistema responde `200`

#### Scenario: Recepción no accede a facturación global

- **WHEN** un usuario con rol `recepcion` consulta el reporte
- **THEN** el sistema responde `403` con `code: "forbidden"`, aunque tenga acceso a caja operativa

#### Scenario: Profesional no accede a facturación

- **WHEN** un usuario con rol `profesional` consulta el reporte
- **THEN** el sistema responde `403` con `code: "forbidden"`

#### Scenario: Consulta sin autenticación rechazada

- **WHEN** se consulta sin token
- **THEN** el sistema responde `401`

### Requirement: Validación de rango y sin PHI

El sistema SHALL aplicar las mismas reglas de rango que `reportes/ocupacion` (`YYYY-MM-DD` real, `desde <= hasta`, máximo 366 días) y SHALL devolver únicamente agregados e identificadores opacos, sin datos de pacientes ni de turnos individuales.

#### Scenario: Rango invertido rechazado

- **WHEN** se consulta con `desde=2026-11-10&hasta=2026-11-01`
- **THEN** el sistema responde `400` con `code: "validacion"`

#### Scenario: Respuesta sin PHI

- **WHEN** se consulta el reporte con movimientos asociados a pacientes ficticios
- **THEN** el cuerpo no contiene nombres, DNI, `paciente_id` ni `turno_id`
