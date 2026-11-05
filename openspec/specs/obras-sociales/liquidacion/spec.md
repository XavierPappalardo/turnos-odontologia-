# obras-sociales/liquidacion Specification

## Purpose
Estructura mínima de liquidación de reintegros por obra social (FL-05, CU-7): cabecera por plan/período, ítems con snapshot de importes por turno, generación en borrador desde coberturas registradas, estados mínimos con **historial auditable append-only del quién/cuándo de la generación y cada transición**, todo restringido a `administracion`, y prevención de duplicaciones o inconsistencias (un turno en una sola liquidación vigente).

## Requirements

### Requirement: Generación de borrador de liquidación

El sistema SHALL exponer `POST /api/obras-sociales/liquidaciones` para `administracion` con body `{obra_social_plan_id, desde, hasta}`. SHALL generar un borrador con ítems de coberturas elegibles del plan filtradas por `turno.inicio` en `[desde, hasta]` (Decisión Q3) y con turno en estado `atendido` (Decisión Q4). SHALL totalizar montos exactos e insertar el evento 'generada' en la misma transacción (`UnitOfWork`). Ver escenarios para exclusiones y validaciones.

#### Scenario: Borrador con ítems y total exacto

- **WHEN** `administracion` genera una liquidación para el plan del seed con dos coberturas vigentes cuyos turnos están en estado `atendido` con `turno.inicio` dentro del período (10.000 y 5.000 centavos de cobertura) y otra cobertura del mismo plan con `turno.inicio` fuera del rango
- **THEN** el sistema responde `201` en estado `borrador`, con exactamente 2 ítems, `monto_total_centavos: 15000` y snapshots idénticos a las coberturas registradas

#### Scenario: Turnos en estado no atendido excluidos

- **WHEN** existe una cobertura cuyo `turno.inicio` cae en el período pero el estado del turno es `confirmado`, `reservado` o `presente`
- **THEN** el borrador excluye ese turno y solo incluye turnos con estado `atendido` (Decisión Q4 aprobada)

#### Scenario: Período evalúa turno.inicio y no fecha de registro de la cobertura

- **WHEN** una cobertura fue registrada fuera del rango `[desde, hasta]` pero su `turno.inicio` cae dentro del período y está `atendido`
- **THEN** la cobertura es incluida en la liquidación evaluando la fecha de atención (Decisión Q3 aprobada)

#### Scenario: Coberturas sin plan objetivo excluidas

- **WHEN** se genera una liquidación del plan A y están registradas coberturas del plan B en el mismo período
- **THEN** el borrador no incluye las coberturas del plan B (cada liquidación es de un único plan)

#### Scenario: Período sin coberturas rechazado

- **WHEN** `administracion` genera una liquidación para un rango sin coberturas elegibles
- **THEN** el sistema responde `400` y no persiste la liquidación

#### Scenario: Rango inválido rechazado

- **WHEN** el body reporta `desde` posterior a `hasta`
- **THEN** el sistema responde `400` y no persiste la liquidación

#### Scenario: Solo administración genera

- **WHEN** un usuario con rol `recepcion` llama `POST /api/obras-sociales/liquidaciones`
- **THEN** el sistema responde `403` y no persiste nada (R4: los reintegros no los operan recepción)

#### Scenario: Plan inexistente

- **WHEN** el body declara un `obra_social_plan_id` inexistente o de baja lógica
- **THEN** el sistema responde `404` y no persiste la liquidación

### Requirement: Unicidad de liquidación por plan y período

El sistema SHALL impedir más de una liquidación vigente (`deleted_at` nulo) para la misma combinación `(obra_social_plan_id, desde, hasta)`; un segundo intento SHALL responder `409` sin persistir. Tras la baja lógica de la cabecera SHALL ser posible re-generar el mismo período (índice único parcial `WHERE deleted_at IS NULL`). La baja lógica de la cabecera SHALL dar de baja, en la misma transacción del `UnitOfWork`, también sus ítems vigentes.

#### Scenario: Re-emisión tras baja lógica

- **WHEN** la liquidación `(plan, período)` se marca de baja lógica y `administracion` genera otra del mismo plan y período
- **THEN** el sistema responde `201` con una cabecera nueva en `borrador`, y los ítems de la liquidación dada de baja conservan su baja lógica (`deleted_at` marcada en la misma transacción de la baja)

### Requirement: Un turno en una sola liquidación vigente

El sistema SHALL impedir que un mismo turno aparezca (ítems vigentes) en más de una liquidación vigente; al generar una liquidación cuyo rango incluya turnos ya liquidados SHALL excluirlos de la generación, y un intento directo SHALL responder `409`. Un reintegro no SHALL poder duplicarse (prevención de duplicaciones en reintegros).

#### Scenario: Regeneración solapada sin duplicar turno

- **WHEN** se genera una segunda liquidación del mismo plan cuyo período se superpone con el de la primera vigente
- **THEN** el borrador excluye el turno ya liquidado y solo incluye los turnos no liquidados restantes del rango

#### Scenario: Guard en base de datos

- **WHEN** se intenta insertar directamente un ítem de liquidación para un turno ya incluido en otra liquidación vigente
- **THEN** SQLite rechaza la escritura por el índice único parcial de la migración 011

### Requirement: Estados mínimos de la liquidación

El sistema SHALL exponer `PATCH /api/obras-sociales/liquidaciones/:id/estado` solo para `administracion` según la máquina `borrador → presentada → pagada` con terminal `pagada` (Decisión Q2); transición inválida SHALL responder `409` sin cambio. Cada transición SHALL actualizar el estado e insertar su evento en la misma transacción, revalidada contra el estado real (perdedora concurrente `409` sin evento duplicado; patch sin filas `404`). Estados alternativos: No evidenciado.

#### Scenario: Transición a presentada

- **WHEN** `administracion` aplica `PATCH` de estado `presentada` sobre un borrador
- **THEN** el sistema responde `200` con `estado: presentada` y el historial agrega el evento 'presentada' con actor y `ocurrido_en` de esa transición

#### Scenario: Atajo inválido rechazado

- **WHEN** `administracion` aplica `PATCH` de estado `pagada` sobre un borrador
- **THEN** el sistema responde `409`, el estado queda `borrador` y el historial no agrega evento alguno

#### Scenario: Estado terminal sin salida

- **WHEN** se aplica `PATCH` sobre una liquidación en `pagada`
- **THEN** el sistema responde `409` con el estado sin cambios

#### Scenario: Solo administración transiciona

- **WHEN** un usuario con rol `profesional` llama `PATCH .../estado`
- **THEN** el sistema responde `403` y el estado queda sin cambios

#### Scenario: Transición concurrente sin evento duplicado

- **WHEN** dos solicitudes simultáneas aplican la misma transición válida sobre la misma liquidación
- **THEN** exactamente una responde `200`, la otra responde `409` y el historial agrega un único evento de esa transición

### Requirement: Historial auditable de transiciones de estado

El sistema SHALL mantener el historial append-only `obra_social_liquidacion_evento` con un evento por generación ('generada') y por cada transición ('presentada'/'pagada'), cada uno con `actor_usuario_id` y `ocurrido_en`. El historial SHALL ser inmutable: la base SHALL rechazar UPDATE/DELETE sobre eventos (triggers de la migración 011). El GET de detalle SHALL listar la timeline ordenada por `ocurrido_en` (ver escenario de detalle).

#### Scenario: La generación crea el primer evento del historial

- **WHEN** `administracion` genera un borrador de liquidación
- **THEN** la tabla `obra_social_liquidacion_evento` contiene exactamente un evento 'generada' para esa liquidación, con el actor del POST y su `ocurrido_en` (la cabecera conserva además `generada_por_usuario_id` como dato de fila; el evento 'generada' es su contraparte en la timeline)

#### Scenario: Cada transición agrega su evento

- **WHEN** `administracion` transiciona un borrador a `presentada` y luego a `pagada`
- **THEN** el historial queda con tres eventos ('generada', 'presentada', 'pagada'), cada uno con actor y `ocurrido_en` del momento de la llamada

#### Scenario: El historial es inmutable en la base

- **WHEN** se intenta directamente un UPDATE o DELETE sobre una fila de `obra_social_liquidacion_evento`
- **THEN** SQLite rechaza la escritura por los triggers insert-only de la migración 011

#### Scenario: Historial visible en el detalle

- **WHEN** `administracion` consulta `GET /api/obras-sociales/liquidaciones/:id` de una liquidación ya pagada
- **THEN** la respuesta incluye la timeline completa de eventos ('generada' → 'presentada' → 'pagada') en orden `ocurrido_en`, con el actor de cada uno, y sin PHI (R3)

### Requirement: Congelamiento de la liquidación presentada

Mientras la liquidación esté `presentada` o `pagada`, el sistema SHALL rechazar (`409`) agregar/quitar ítems y limitar la edición de la cabecera al endpoint de transición (ver historial).

#### Scenario: Ajustes bloqueados tras presentada

- **WHEN** tras `presentada` se intenta agregar o quitar un ítem
- **THEN** el sistema responde `409` y los ítems quedan intactos y auditables

### Requirement: Agregado controlado de ítems al borrador

En `borrador` el sistema SHALL permitir agregar ítems elegibles recalculando `monto_total_centavos` dentro de la misma transacción del `UnitOfWork` como la suma exacta de los ítems vigentes más el nuevo ítem, con las verificaciones revalidadas contra el estado real. Un total que exceda `Number.MAX_SAFE_INTEGER` SHALL responder `400 monto_no_representable` con rollback (R2); agregar una cobertura no elegible (otro plan, ya liquidada o fuera del rango) SHALL responder `400`.

#### Scenario: Ítem agregado en borrador recalcula total

- **WHEN** `administracion` agrega a un borrador una cobertura elegible del plan por 12.000 centavos de cobertura
- **THEN** el sistema responde `200` con el ítem agregado y `monto_total_centavos` incrementado en 12.000

#### Scenario: Agregados concurrentes no pierden contribuciones

- **WHEN** dos solicitudes simultáneas agregan a un borrador ítems elegibles diferentes (coberturas de turnos distintos)
- **THEN** ambas responden `200` con éxito garantizado y la cabecera queda exactamente igual a la suma de los ítems vigentes, sin importes perdidos (el total se recalcula dentro de la transacción)

#### Scenario: Total no representable rechazado con rollback

- **WHEN** una generación o un agregado cuyo total resultante excede `Number.MAX_SAFE_INTEGER` (p. ej. dos reintegros de 9·10^15 centavos cada uno al 100 %, ficticio)
- **THEN** el sistema responde `400` con error `monto_no_representable` y no persiste cabecera ni ítem alguno

#### Scenario: Cobertura no elegible rechazada

- **WHEN** se intenta agregar a un borrador del plan A una cobertura del plan B
- **THEN** el sistema responde `400` y no modifica el borrador

### Requirement: Consulta trazable de liquidaciones

El sistema SHALL exponer `GET /api/obras-sociales/liquidaciones` y `GET /api/obras-sociales/liquidaciones/:id` solo para `administracion` (otros roles `403`), devolviendo cabecera, ítems con snapshots e historial de eventos ordenado por `ocurrido_en`. Los snapshots persistidos no SHALL cambiar ante cambios posteriores de los datos fuente (p. ej. `cobertura_pct` del plan). La respuesta SHALL omitir PHI (R3).

#### Scenario: Detalle con snapshots invariantes

- **WHEN** el `cobertura_pct` del plan cambia en el catálogo luego de generar la liquidación y `administracion` consulta `GET .../liquidaciones/:id`
- **THEN** los ítems devueltos conservan los importes snapshot grabados al generar o agregar, no los valores vigentes del plan

#### Scenario: Recepción no consulta liquidaciones

- **WHEN** un usuario con rol `recepcion` llama `GET /api/obras-sociales/liquidaciones`
- **THEN** el sistema responde `403` (los reintegros no se exponen a recepción, R4)
