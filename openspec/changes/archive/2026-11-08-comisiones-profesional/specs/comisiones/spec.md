# Spec Delta — comisiones

## Purpose

Liquidación de comisiones por profesional (RN-08, F-09, FL-05/CU-7): configuración de porcentajes (general por profesional y específico por tratamiento), cálculo sobre **producción cobrada** y atribuible al profesional, vista previa sin persistencia, generación de borrador con ítems-snapshot, confirmación administrativa terminal, estados lineales con **historial auditable append-only del quién/cuándo**, prevención de doble comisión (un cobro en una sola liquidación vigente), todo restringido a `administracion` salvo el portal de consulta del propio profesional. Decisions Q1–Q7 ratificadas por el owner (2026-11-06): base excluyente de obra_social, turnos `atendido`, fecha contable, **ajustes compensatorios en liquidación futura (D12, con reserva exclusiva y saldo de compensación)**, truncado, portal confirmado-only, guard cobro-único; **fingerprint del cálculo (D13)** garantiza confirmar lo revisado.

## ADDED Requirements

### Requirement: Configuración de comisión general por profesional

El sistema SHALL exponer `PUT`/`GET /api/comisiones/configuraciones/:profesionalId` exclusivamente para `administracion`, con `pct_general` entero 0..100 (R6) y una única configuración vigente por profesional (upsert idempotente).

#### Scenario: Administración configura % general

- **WHEN** `administracion` envía `PUT /api/comisiones/configuraciones/:profesionalId` con `pct_general: 40` para un profesional activo sin configuración previa
- **THEN** el sistema responde `201`/`200` con la configuración persistida y `pct_general: 40`

#### Scenario: Upsert idempotente

- **WHEN** `administracion` vuelve a enviar el mismo `PUT` con `%` actualizado (p. ej. 45) para el mismo profesional
- **THEN** no se duplica la configuración (sigue existiendo una única fila vigente) y el valor queda en 45

#### Scenario: % fuera de rango rechazado

- **WHEN** el body declara `pct_general: 140` o `-5` o un valor no entero
- **THEN** el sistema responde `422` con error `validacion` y no persiste nada (R6)

#### Scenario: Solo administración configura

- **WHEN** un usuario con rol `recepcion` o `profesional` llama `PUT /api/comisiones/configuraciones/:profesionalId`
- **THEN** el sistema responde `403` y no persiste nada (R4)

#### Scenario: Profesional inexistente

- **WHEN** el `:profesionalId` no corresponde a un profesional existente o con baja lógica
- **THEN** el sistema responde `404` con error `not_found`

### Requirement: Configuración de comisión por tratamiento

El sistema SHALL permitir a `administracion` configurar porcentajes específicos por `(profesional_id, prestacion_id)` (enteros 0..100, R6), con una única fila vigente por par y reemplazo completo de la lista en una misma transacción.

#### Scenario: Administración configura % específico por prestación

- **WHEN** `administracion` envía el `PUT` de configuración con `tratamientos: [{prestacion_id: P1, pct: 30}, {prestacion_id: P2, pct: 25}]`
- **THEN** quedan vigentes exactamente 2 configuraciones por tratamiento para ese profesional y el `GET` posterior las devuelve

#### Scenario: Reemplazo completo de la lista de tratamientos

- **WHEN** la configuración vigente incluye P1 y P2 y `administracion` re-envía el `PUT` con solo `P2` al 20 % y el mismo `pct_general`
- **THEN** la fila de P1 queda de baja lógica, P2 queda vigente al 20 % y NO persiste una fila duplicada de P2 (UNIQUE parcial)

#### Scenario: Prestación duplicada en el body rechazada

- **WHEN** el body incluye dos entradas con el mismo `prestacion_id`
- **THEN** el sistema responde `422` con error `validacion` y no persiste nada

### Requirement: Vista previa de liquidación

El sistema SHALL exponer `POST /api/comisiones/preview` para `administracion` con body `{profesional_id, desde, hasta}`. SHALL calcular en vivo ítems, ajustes pendientes y total neto **sin persistir ninguna tabla**, y SHALL responder un `fingerprint` SHA-256 determinista del cálculo (D13). Rango inválido → `422`; % sin configurar → `422` con `sin_configuracion`.

#### Scenario: Vista previa con ítems y total sin persistir

- **WHEN** `administracion` llama `POST /api/comisiones/preview` para un período con 2 cobros elegibles y `%` configurado
- **THEN** responde `200` con ítems (cobro, regla aplicada, % aplicado, comisión truncada), ajustes pendientes, `fingerprint` y total neto Σ exacta, y NO quedan filas en `liquidacion_comision`, `liquidacion_comision_item` ni eventos

#### Scenario: Fingerprint determinista y sensible a cambios

- **WHEN** se previsualiza dos veces sin cambios, luego se cambia el `pct_general` del profesional y se previsualiza de nuevo
- **THEN** las dos primeras respuestas comparten el mismo `fingerprint` y la tercera difiere (el hash cubre config, tratamientos, cobros elegibles y ajustes — D13)

#### Scenario: Dos vistas previas idénticas no generan cabeceras

- **WHEN** se llama al preview dos veces seguidas con el mismo body
- **THEN** ambas responden `200` con el mismo resultado y el conteo de liquidaciones persistidas sigue siendo cero

#### Scenario: Sin configuración de comisión

- **WHEN** el preview se solicita para un profesional sin `%` general ni por tratamiento configurados
- **THEN** responde `422` con error `sin_configuracion` y no persiste nada

#### Scenario: Cobros no atribuibles reportados

- **WHEN** el período incluye un pago `cobrado` de presupuesto sin `turno_id` atribuible a un profesional
- **THEN** el preview lo reporta en una sección de descartes (motivo `no_atribuible`) y no genera ítem para él

### Requirement: Base de cálculo sobre producción cobrada

El cálculo SHALL considerar solo pagos `cobrado` vigentes con medio ≠ `obra_social` (Q1 ratificada) y turno `atendido` (Q2 ratificada). Cada pago genera un ítem (parciales sin consolidar); quedan excluidos `pendiente`, `anulado` y los cobros de presupuesto sin turno del profesional (reportados como no atribuibles). Con coexistencia de referencias (`turno_id` + `presupuesto_id`) el turno del pago es la referencia principal y el presupuesto no se re-procesa (D2).

#### Scenario: Pago cobrado incluido en la base

- **WHEN** existe un pago `estado: cobrado` de 20.000 centavos de un turno `atendido` del profesional dentro del período
- **THEN** genera un ítem de liquidación con `monto_cobro_centavos: 20000` y la comisión según el % aplicable (Q5: truncado)

#### Scenario: Pago anulado excluido

- **WHEN** un pago fue `anulado` (o su movimiento de caja es de anulación) dentro o fuera del período
- **THEN** no genera ítem de liquidación ningún período

#### Scenario: Pago pendiente excluido

- **WHEN** un pago está en `pendiente` (saldo por cobrar) al calcular
- **THEN** no genera ítem; entra a la base recién al pasar a `cobrado`

#### Scenario: Medio obra social excluido (Decisión Q1 ratificada)

- **WHEN** un pago `cobrado` tiene `medio: obra_social`
- **THEN** no genera ítem de comisión (la comisión se calcula sobre lo efectivamente cobrado al paciente — decisión ratificada por el owner, 2026-11-06)

#### Scenario: Pagos parciales liquidados ítem por pago

- **WHEN** un turno de 30.000 centavos se cobró en 3 pagos `cobrado` de 10.000 cada uno
- **THEN** la liquidación registra 3 ítems (uno por pago), cada uno al `%` aplicable, y el total es la Σ de las 3 comisiones

#### Scenario: Presupuesto con turno del profesional entra con % general

- **WHEN** un pago `cobrado` referencia un presupuesto cuyo `turno_id` apunta a un turno del profesional
- **THEN** genera ítem con `regla_aplicada: general` (no existe atribución fina por ítem de presupuesto; se difiere a change futuro)

#### Scenario: Doble referencia incompatible excluida con motivo

- **WHEN** un pago `cobrado` declara `turno_id` y `presupuesto_id`, y el `turno_id` del presupuesto apunta a un turno DISTINTO del `turno_id` del pago
- **THEN** no genera ítem: queda en los descartes de la preview con el motivo de doble referencia incompatible (el turno del pago es la referencia principal; D2)

### Requirement: Delimitación temporal del período

El rango `[desde, hasta]` (fechas ISO, R6) SHALL evaluar cada cobro por la **fecha contable de caja** (`movimiento_caja.fecha_contable`) de su movimiento de `cobro` (Decisión Q3 ratificada, coherente con "producción cobrada" y RN-09), no por `turno.inicio` ni por registro. Los límites son inclusivos. Si el pago no tiene movimiento asociado (dato previo), `pago.created_at` es el fallback documentado (no requerido en MVP para cobros C-11).

#### Scenario: Cobro incluido por fecha contable dentro del rango

- **WHEN** el pago cobrado tiene movimiento con `fecha_contable: 2026-11-10` y el período es `2026-11-01..2026-11-30`
- **THEN** el cobro es elegible y genera ítem

#### Scenario: Cobro excluido por fecha contable fuera del rango aunque el turno esté en el rango

- **WHEN** el turno es de `2026-11-05` pero su pago se cobró (fecha contable) el `2026-12-02` y el período es `2026-11-01..2026-11-30`
- **THEN** el cobro NO es elegible para noviembre (Decisión Q3 ratificada; `turno.inicio` queda solo como alternativa futura)

#### Scenario: Rango inválido rechazado

- **WHEN** el body declara `desde` posterior a `hasta` o fechas fuera del formato ISO
- **THEN** responde `422` con error `validacion` y no persiste nada (preview) ni genera cabecera (generación)

### Requirement: Prioridad de la regla de comisión

Para cada ítem, el % SHALL resolverse: si existe configuración específica vigente del par `(profesional, prestación del turno)` se aplica ésa (`regla_aplicada: tratamiento`); si no, el `pct_general` del profesional (`regla_aplicada: general`); cobros sin prestación o por presupuesto-con-turno SHALL aplicar siempre `general`. Los porcentajes nunca se suman (RN-08: específico reemplaza al general) y los cobros por presupuesto-con-turno no aplican regla por tratamiento.

#### Scenario: % específico reemplaza al general

- **WHEN** el profesional tiene `pct_general: 40` y configuración específica `30` para la prestación del turno cobrado
- **THEN** el ítem usa `pct_aplicado: 30` y `regla_aplicada: tratamiento` (no 70 ni 40)

#### Scenario: Sin configuración específica aplica el general

- **WHEN** el profesional tiene `pct_general: 40` y NO hay configuración para la prestación del turno cobrado
- **THEN** el ítem usa `pct_aplicado: 40` y `regla_aplicada: general`

#### Scenario: Turno sin prestación aplica general

- **WHEN** un cobro de turno sin `prestacion_id` entra en la base
- **THEN** el ítem usa `regla_aplicada: general` con el `pct_general` vigente

### Requirement: Generación de borrador de liquidación

El sistema SHALL exponer `POST /api/comisiones/liquidaciones` y `POST .../:id/regenerar` para `administracion` con body que exige `fingerprint`. SHALL generar/regenerar una cabecera `borrador` con ítems-snapshot, ajustes si los hay (D12) y el evento append-only `generada` en una misma transacción (R12); `fingerprint` divergente con el cálculo vivo intra-tx → `409 preview_desactualizado` sin persistir. Un cobro SHALL pertenecer a una única liquidación vigente (guard anti doble-comisión).

#### Scenario: Borrador con ítems y total exacto

- **WHEN** `administracion` genera para un profesional con 2 cobros elegibles (10.000 c/30 % y 20.000 c/40 %, truncado Q5)
- **THEN** responde `201` en `borrador` con 2 ítems (`monto_comision_centavos` 3.000 y 8.000), `monto_total_centavos: 11000` y el evento `generada` registrado con el actor

#### Scenario: Período ya liquidado

- **WHEN** existe una liquidación vigente `(p, desde, hasta)` y se intenta generar la misma combinación
- **THEN** responde `409` con `periodo_ya_liquidado` y no persiste una segunda cabecera (UNIQUE parcial)

#### Scenario: Cobro ya liquidado para otro período/profesional

- **WHEN** la generación incluye un cobro que ya figura en una liquidación vigente de otro período
- **THEN** responde `409` con `cobro_ya_liquidado`, no persiste la cabecera ni ítems parciales (todo intra-tx)

#### Scenario: Regeneración del borrador reemplaza ítems

- **WHEN** se llama `POST .../:id/regenerar` con el `fingerprint` vigente en un borrador al que se anuló uno de sus cobros
- **THEN** el ítem del cobro anulado queda de baja lógica, el snapshot se recalcula con los datos vigentes y el total se ajusta, sin duplicar el evento `generada` (el historial previo se conserva)

#### Scenario: Fingerprint desactualizado rechaza la generación

- **WHEN** entre el preview y la generación cambió cualquier input del cálculo (p. ej. el `pct_general`) y se envía el fingerprint del preview viejo
- **THEN** responde `409` con `preview_desactualizado`, no persiste cabecera ni ítems, y la administración debe re-previsualizar (D13)

#### Scenario: Solo administración genera

- **WHEN** un usuario con rol `recepcion` llama `POST /api/comisiones/liquidaciones`
- **THEN** responde `403` y no persiste nada (R4)

### Requirement: Confirmación de liquidación

El sistema SHALL exponer `POST /api/comisiones/liquidaciones/:id/confirmar` para `administracion` con una transición única y lineal `borrador → confirmada`. SHALL exigir `fingerprint` en el body: intra-tx `BEGIN IMMEDIATE` se re-deriva el cálculo vivo (D13) y si difiere de lo revisado → `409 preview_desactualizado`; solo entonces se congela el snapshot con el evento `confirmada`.

#### Scenario: Confirmación verifica y congela el snapshot

- **WHEN** `administracion` confirma con el `fingerprint` vigente y ningún input cambió desde la generación/regeneración
- **THEN** la re-derivación intra-tx iguala al borrador, se congelan ítems y total, y queda el evento `confirmada` con actor; cambios posteriores de % no alteran esa liquidación

#### Scenario: Cobro anulado entre generación y confirmación

- **WHEN** un cobro incluido en el borrador fue anulado después de generarlo y se intenta confirmar con el `fingerprint` del borrador
- **THEN** responde `409` con `preview_desactualizado`; tras regenerar con la vista previa actualizada, el ítem anulado queda fuera del snapshot y la confirmación exitosa se produce sin él (no hay ajuste: el ítem nunca llegó a `confirmada`)

#### Scenario: Configuración cambiada tras el borrador

- **WHEN** se modificó el `pct_general` del profesional después de generar el borrador y se intenta confirmar con el fingerprint de generación
- **THEN** responde `409` con `preview_desactualizado` y nada se congela (re-preview + regenerar + confirmar con fingerprint fresco)

#### Scenario: Doble confirmación rechazada

- **WHEN** se llama `confirmar` sobre una liquidación ya `confirmada` (incluye doble-click concurrente con 2 conexiones reales)
- **THEN** la primera transiciona a `confirmada` y la segunda responde `422`/`409` con `estado_invalido` sin duplicar eventos ni mutar el snapshot

#### Scenario: Solo administración confirma

- **WHEN** un usuario con rol `profesional` llama `POST /api/comisiones/liquidaciones/:id/confirmar`
- **THEN** responde `403` y el estado no cambia (R4)

### Requirement: Consultas y scoping del portal del profesional

El sistema SHALL exponer `GET /api/comisiones/mis-liquidaciones` al rol `profesional` con scoping forzado por `usuario.profesional_id` y solo liquidaciones confirmadas (Q6 ratificada); los borradores y las liquidaciones ajenas no se exponen.

#### Scenario: Profesional ve solo sus confirmadas

- **WHEN** el profesional `P1` llama `GET /api/comisiones/mis-liquidaciones` y existen para P1 dos confirmadas y un borrador, y una confirmada de P2
- **THEN** responde `200` con exactamente las 2 confirmadas de P1 (sin borradores propios ni datos de P2)

#### Scenario: Scoping no manipulable por body o query

- **WHEN** el profesional envía en la query `profesional_id=P2` (otro profesional)
- **THEN** el backend ignora el parámetro y responde únicamente con las liquidaciones confirmadas de su propio `usuario.profesional_id`

#### Scenario: Borrador propio no visible en portal

- **WHEN** el profesional de un borrador propio consulta `mis-liquidaciones`
- **THEN** el borrador no aparece en el listado (Q6 ratificada por el owner, 2026-11-06)

#### Scenario: Detalle de liquidación ajena oculto

- **WHEN** el profesional llama `GET /api/comisiones/liquidaciones/:id` de una liquidación de otro profesional
- **THEN** responde `404` y no expone montos ni nombres (R3)

### Requirement: Ajustes compensatorios por anulación posterior

El sistema SHALL detectar pagos anulados con comisión en liquidaciones confirmadas y SHALL reservar el ajuste en la próxima `borrador` transaccionalmente (UNIQUE parcial). Una generación con `fingerprint` previo a la reserva SHALL responder `409 preview_desactualizado` sin persistir nada; tras nueva preview SHALL generar sin el ajuste reservado. Al confirmar SHALL absorberlos in-order con `monto_compensado` y, si exceden los ítems, registrar `saldo_compensacion_centavos` (sin pagos negativos).

#### Scenario: Ajuste reservado en la próxima liquidación

- **WHEN** se anula un pago cuya comisión radica en una liquidación confirmada del profesional y luego se genera un borrador nuevo para ese profesional
- **THEN** la generación crea, en su misma transacción, una fila de ajuste `estado_ajuste: reservado` con `item_origen_id` y `pago_id` del ítem confirmado, `monto_ajuste_centavos` = la comisión original truncada (no recalculada), y el total neto resta ese monto

#### Scenario: Reserva exclusiva entre borradores activos

- **WHEN** con un ajuste pendiente se generan dos borradores y el primero crea su fila `reservado` dentro de `BEGIN IMMEDIATE` después de que el segundo obtuvo su preview
- **THEN** el segundo intento, enviado con el `fingerprint` previo a la reserva, responde `409` con `preview_desactualizado` sin persistir cabecera, ítems ni reservas, y no puede existir más de una fila `reservado` para ese `item_origen_id` (índice único parcial de BD)

#### Scenario: Reintento exitoso con preview posterior

- **WHEN** el segundo administrador obtiene una nueva preview —cuyo fingerprint ya refleja la exclusión del ajuste reservado— y vuelve a generar
- **THEN** la generación es exitosa sin ese ajuste, coincide con la nueva preview, y el ajuste reservado queda solo en la cabecera del primer borrador (sin doble reserva)

#### Scenario: Liberación por baja del borrador portador

- **WHEN** el borrador que contiene ajustes reservados se marca de baja lógica
- **THEN** cabecera, ítems y filas de ajuste reciben `deleted_at` en la misma transacción; la reserva se libera y el ajuste vuelve a ser pendiente para la próxima generación

#### Scenario: Absorción in-order y saldo cuando los ajustes superan los ítems

- **WHEN** se confirma un borrador con `monto_items_centavos: 10000` y ajustes por 15.000 (orden determinista por `pago.anulado_en`, `pago_id`)
- **THEN** la confirmación es permitida: se compensan 10.000 asignando `monto_compensado` por fila (la última parcialmente), `monto_total_centavos: -5000`, `saldo_compensacion_centavos: 5000` y `estado_ajuste: consumido` con `compensado_en`; NO se genera ningún pago negativo automático

#### Scenario: Saldo compensado en períodos posteriores

- **WHEN** se genera un borrador posterior para el profesional habiendo saldo de compensación pendiente (restos `monto_ajuste - monto_compensado` de filas consumidas)
- **THEN** el borrador incluye filas `tipo_ajuste: saldo_arrastre` con `monto` = el resto pendiente (snapshot), con la misma reserva exclusiva; su confirmación absorbe las comisiones nuevas

#### Scenario: La liquidación confirmada original permanece inmutable

- **WHEN** después de la anulación y del ajuste se consulta la liquidación confirmada original
- **THEN** sus ítems y `monto_total_centavos` originales están intactos (no se retroedita; la compensación vive en la liquidación futura — Q4 ratificada)

#### Scenario: Preview muestra ajustes pendientes sin persistir

- **WHEN** el preview corre habiendo ajustes pendientes (anulación nueva o saldo de arrastre) sin borrador generado
- **THEN** la respuesta lista los ajustes pendientes (`pago_id`, `item_origen_id`, `monto`) y el total neto tentativo los refleja, sin persistir nada

### Requirement: Historial append-only y trazabilidad

El sistema SHALL registrar cada transición como evento append-only en `liquidacion_comision_evento` con `{liquidacion_id, evento: 'generada'|'confirmada', actor_usuario_id, ocurrido_en}`. Los eventos SHALL ser inmutables: triggers insert-only SHALL rechazar `UPDATE` y `DELETE` (estilo C-09/C-12). La cabecera confirmada y sus ítems-snapshot SHALL ser inmutables (baja lógica solamente, y nunca regenerar ítems de una confirmada).

#### Scenario: Eventos generada y confirmada con actor

- **WHEN** se genera y confirma una liquidación por el usuario administrador `U1`
- **THEN** existen exactamente 2 eventos con `evento` `generada` y `confirmada`, `actor_usuario_id: U1` y `ocurrido_en` reciente

#### Scenario: Eventos inmutables por trigger

- **WHEN** se intenta `UPDATE` o `DELETE` sobre un evento registrado
- **THEN** el trigger rechaza la operación con error (append-only, R4)

#### Scenario: Snapshot de liquidación confirmada inmutable

- **WHEN** se intenta regenerar o modificar ítems de una liquidación `confirmada`
- **THEN** el sistema rechaza con `estado_invalido` y el snapshot persiste sin cambios (D4/Q4)

### Requirement: Errores estándar y privacidad

El capability SHALL usar `ComisionErrorCode = 'validacion' | 'not_found' | 'estado_invalido' | 'cobro_ya_liquidado' | 'periodo_ya_liquidado' | 'sin_configuracion' | 'identidad_ya_configurada' | 'preview_desactualizado'` mapeado a HTTP 422 / 404 / 409 (patrón `CajaErrorCode` de C-11), sin PHI en respuestas ni logs (R3). Los conflictos de UNIQUE de configuración SHALL responder `409` con `identidad_ya_configurada`.

#### Scenario: Mapeo de errores a HTTP

- **WHEN** se provocan los errores `validacion`, `estado_invalido`, `cobro_ya_liquidado`, `periodo_ya_liquidado`, `preview_desactualizado` y `not_found` en el flujo completo
- **THEN** el sistema responde `422`, `422`/`409`, `409`, `409`, `409` y `404` respectivamente, con el payload de error estándar del backend (sin stack ni SQL)

#### Scenario: Conflicto de configuración concurrente

- **WHEN** dos `PUT` de configuración concurrentes para el mismo profesional chocan con la UNIQUE vigente
- **THEN** una persiste y la otra responde `409` con `identidad_ya_configurada` (transacción `BEGIN IMMEDIATE`, R12)

#### Scenario: Errores sin PHI

- **WHEN** cualquier error del capability se registra en log o responde al cliente
- **THEN** el payload y el log no contienen nombre de paciente, documento ni datos clínicos (R3), solo ids internos del dominio de comisiones
