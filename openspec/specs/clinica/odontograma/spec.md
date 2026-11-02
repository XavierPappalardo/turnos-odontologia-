# Spec Delta — clinica/odontograma

## Purpose

Registra los hallazgos del odontograma como eventos inmutables por pieza FDI y superficie, valida las combinaciones pieza-superficie y deriva el estado actual de cada superficie sin perder el historial.

## ADDED Requirements

### Requirement: Codificación FDI y catálogo de hallazgos

El sistema SHALL aceptar piezas FDI permanentes de 11 a 48 y temporales de 51 a 85, superficies `M`, `D`, `V`, `L`, `O`, `I`, y los hallazgos `sano`, `caries`, `obturado`, `ausente`, `corona`, `endodoncia`, `implante`, `extraccion_indicada`, `sellante` y `fractura`; SHALL rechazar con `400` todo valor fuera de catálogo.

#### Scenario: Pieza FDI inválida

- **WHEN** se envía un evento con `pieza` `19`, `49`, `00` o `86`
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Hallazgo fuera de catálogo

- **WHEN** se envía un evento con `hallazgo = "mancha"`
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Pieza temporal aceptada

- **WHEN** se envía un evento con `pieza` `75`, superficie `M` y hallazgo `caries`
- **THEN** el sistema responde `201` y persiste el evento

### Requirement: Compatibilidad entre pieza y superficie

El sistema SHALL aceptar `I` solo en incisivos y caninos, y `O` solo en premolares y molares; SHALL rechazar con `400` toda combinación inválida antes de persistir el evento.

#### Scenario: Incisal válido en incisivo

- **WHEN** se envía `pieza` `11` con superficie `I`
- **THEN** el sistema responde `201`

#### Scenario: Incisal en molar permanente

- **WHEN** se envía `pieza` `16` con superficie `I`
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Oclusal válido en molar

- **WHEN** se envía `pieza` `16` con superficie `O`
- **THEN** el sistema responde `201`

#### Scenario: Oclusal en incisivo

- **WHEN** se envía `pieza` `11` con superficie `O`
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Oclusal válido en molar temporal

- **WHEN** se envía `pieza` `55` con superficie `O`
- **THEN** el sistema responde `201`

#### Scenario: Oclusal en incisivo temporal

- **WHEN** se envía `pieza` `52` con superficie `O`
- **THEN** el sistema responde `400` y no persiste el evento

### Requirement: Registro de eventos del odontograma

El sistema SHALL exponer `POST /api/pacientes/:id/odontograma/eventos` que persiste un evento inmutable con `pieza`, `superficie`, `hallazgo`, `ocurrido_en` ISO 8601 con zona, `turno_id` opcional y `enmienda_de` opcional, y responde `201` con el evento creado.

#### Scenario: Profesional registra un hallazgo

- **WHEN** un profesional con acceso envía `pieza` `16`, superficie `O`, hallazgo `caries`, `ocurrido_en` válido y sin `turno_id`
- **THEN** el sistema responde `201` con el evento persistido, `actor_usuario_id` del usuario y `es_vigente: true`

#### Scenario: Evento inválido no persiste nada

- **WHEN** se envía un evento con `pieza` `16` y superficie `I`
- **THEN** el sistema responde `400` y el odontograma del paciente no cambia

### Requirement: Estado actual por superficie

El sistema SHALL exponer `GET /api/pacientes/:id/odontograma` que devuelve, por pieza y superficie, el último evento no enmendado según `ocurrido_en` descendente e `id` descendente; las superficies sin eventos SHALL omitirse y equivaler a `sano`.

#### Scenario: Paciente sin eventos

- **WHEN** se consulta el odontograma de un paciente sin eventos
- **THEN** el sistema responde `200` con `piezas: []`

#### Scenario: Gana el evento más reciente

- **WHEN** la superficie `16-O` tiene `caries` y luego `obturado`
- **THEN** el estado actual devuelve `obturado` para `16-O`

#### Scenario: Desempate por id

- **WHEN** dos eventos de la misma pieza y superficie comparten `ocurrido_en`
- **THEN** el estado actual devuelve el evento con `id` mayor

#### Scenario: Evento enmendado no cuenta

- **WHEN** el último evento de `16-O` fue enmendado porque la pieza correcta era `26`
- **THEN** el estado actual de `16-O` vuelve al hallazgo vigente anterior, o a `sano` si no existe otro

### Requirement: Historial por pieza

El sistema SHALL exponer `GET /api/pacientes/:id/odontograma/historial?pieza=<fdi>` que devuelve todos los eventos de la pieza en orden cronológico, incluidos los enmendados y con `es_vigente`; SHALL responder `400` si la pieza no es FDI válida.

#### Scenario: Evolución completa de una pieza

- **WHEN** la pieza `16` tiene eventos `caries` y luego `obturado`
- **THEN** la respuesta `200` devuelve ambos eventos en orden cronológico

#### Scenario: Pieza sin eventos

- **WHEN** se consulta el historial de una pieza válida sin eventos
- **THEN** el sistema responde `200` con lista vacía

#### Scenario: Pieza inválida en el historial

- **WHEN** se consulta con `pieza=99`
- **THEN** el sistema responde `400` y no devuelve eventos

### Requirement: Enmienda de hallazgo

El sistema SHALL exponer `POST /api/pacientes/:id/odontograma/eventos/:eventoId/enmiendas` que crea un evento nuevo con `enmienda_de` y `motivo_enmienda`; el evento original SHALL permanecer intacto y SHALL dejar de contar para el estado actual. La enmienda SHALL heredar el `ocurrido_en` del original e ignorar el enviado por el cliente.

#### Scenario: Corrección de pieza mal cargada

- **WHEN** se enmienda un evento de `16-O` indicando que la pieza correcta era `26`
- **THEN** el evento original queda intacto y no vigente, `16-O` vuelve a su estado anterior y `26` refleja el hallazgo corregido

#### Scenario: La enmienda no pisa la evolución posterior

- **WHEN** `16-O` tiene `caries` el 10/01 y `obturado` el 10/02, y el 03/03 se enmienda el evento del 10/01
- **THEN** el estado actual de `16-O` sigue siendo `obturado`, porque la enmienda hereda el instante del 10/01 y no se adelanta al 10/02

#### Scenario: Enmienda de un evento ya enmendado

- **WHEN** se intenta enmendar el mismo evento por segunda vez
- **THEN** el sistema responde `409` y no persiste un evento nuevo

### Requirement: Inmutabilidad de eventos del odontograma

El sistema SHALL rechazar a nivel SQLite todo `UPDATE` o `DELETE` sobre `odontograma_evento` mediante triggers `BEFORE` que abortan la operación, y SHALL NOT exponer endpoints de edición o baja de eventos.

#### Scenario: UPDATE directo rechazado por trigger

- **WHEN** se intenta cambiar el `hallazgo` de un evento con SQL directo
- **THEN** SQLite aborta la operación y la fila conserva el valor original

#### Scenario: DELETE directo rechazado por trigger

- **WHEN** se intenta borrar un evento del odontograma con SQL directo
- **THEN** SQLite aborta la operación y el evento sigue existiendo
