# Spec Delta — clinica/historia-clinica

## Purpose

Registra la historia clínica de un paciente como una secuencia de eventos inmutables enmendables, preservando el historial completo y derivando el estado vigente sin sobrescribir datos.

## ADDED Requirements

### Requirement: Registro de eventos clínicos

El sistema SHALL exponer `POST /api/pacientes/:id/historia-clinica/eventos` que persiste un evento inmutable con `tipo` (`consulta`, `nota`, `diagnostico`, `procedimiento`), `ocurrido_en` en ISO 8601 con zona explícita, `detalle` no vacío y `turno_id` opcional, y responde `201` con el evento creado.

#### Scenario: Profesional registra una consulta

- **WHEN** un profesional con acceso al paciente envía un evento `consulta` con `ocurrido_en`, `detalle` ficticio y sin `turno_id`
- **THEN** el sistema responde `201` con el evento persistido, su `id`, `actor_usuario_id` igual al usuario autenticado, `profesional_id` igual al del usuario y `es_vigente: true`

#### Scenario: Evento asociado a un turno del paciente

- **WHEN** se registra un evento con un `turno_id` que pertenece al paciente
- **THEN** el sistema responde `201` y el evento devuelto conserva ese `turno_id`

### Requirement: Ficha longitudinal del paciente

El sistema SHALL exponer `GET /api/pacientes/:id/historia-clinica` que devuelve todos los eventos del paciente ordenados por `ocurrido_en` ascendente y `id` ascendente, cada uno con `es_vigente` derivado; SHALL responder `200` con lista vacía si no hay eventos y `404` si el paciente no existe.

#### Scenario: Paciente sin eventos clínicos

- **WHEN** un profesional con acceso consulta la HC de un paciente que no tiene eventos
- **THEN** el sistema responde `200` con `eventos: []`

#### Scenario: Orden estable con el mismo instante

- **WHEN** dos eventos del paciente comparten el mismo `ocurrido_en`
- **THEN** el sistema los devuelve ordenados por `id` ascendente y el resultado es reproducible entre llamadas

### Requirement: Filtro de eventos por turno

El sistema SHALL aceptar el filtro opcional `turno_id` en `GET /api/pacientes/:id/historia-clinica` y devolver solo los eventos asociados a ese turno; un `turno_id` que no pertenece al paciente SHALL responder `400`.

#### Scenario: Filtro devuelve solo el turno pedido

- **WHEN** el paciente tiene eventos con y sin `turno_id` y se consulta con `turno_id=<turno del paciente>`
- **THEN** la respuesta `200` incluye solo los eventos asociados a ese turno

#### Scenario: Turno de otro paciente

- **WHEN** se consulta la HC con un `turno_id` que pertenece a otro paciente
- **THEN** el sistema responde `400` y no devuelve eventos

### Requirement: Enmienda de evento clínico

El sistema SHALL exponer `POST /api/pacientes/:id/historia-clinica/eventos/:eventoId/enmiendas` que crea un evento nuevo con `enmienda_de` y `motivo_enmienda` no vacío; el evento original SHALL permanecer intacto, ambos SHALL aparecer en el historial y solo el nuevo SHALL contar como vigente. La enmienda SHALL heredar el `ocurrido_en` del original e ignorar el enviado por el cliente.

#### Scenario: Enmienda corrige sin alterar el original

- **WHEN** se enmienda un evento con un `motivo_enmienda` ficticio y un `detalle` corregido
- **THEN** el sistema responde `201`, el evento original conserva su `detalle`, `ocurrido_en` y `actor_usuario_id`, y la HC devuelve ambos eventos con el original en `es_vigente: false`

#### Scenario: La enmienda conserva el instante clínico

- **WHEN** el paciente tiene un evento del 10/01 y otro del 20/01, y se enmienda el del 10/01 el 03/03
- **THEN** el evento de enmienda se persiste con `ocurrido_en` del 10/01 y la HC lo devuelve en esa posición, no al final

#### Scenario: Enmienda de un evento ya enmendado

- **WHEN** se intenta enmendar el mismo evento por segunda vez
- **THEN** el sistema responde `409` y no persiste un evento nuevo

#### Scenario: Enmienda de un evento ajeno al paciente

- **WHEN** se enmienda un `eventoId` que pertenece a otro paciente
- **THEN** el sistema responde `404` y no modifica ni crea eventos

### Requirement: Inmutabilidad de eventos clínicos

El sistema SHALL rechazar a nivel SQLite todo `UPDATE` o `DELETE` sobre `hc_evento` mediante triggers `BEFORE` que abortan la operación, y SHALL NOT exponer endpoints de edición o baja de eventos.

#### Scenario: UPDATE directo rechazado por trigger

- **WHEN** se intenta actualizar `detalle` de un evento con SQL directo
- **THEN** SQLite aborta la operación y la fila conserva su contenido original

#### Scenario: DELETE directo rechazado por trigger

- **WHEN** se intenta borrar un evento con SQL directo
- **THEN** SQLite aborta la operación y el evento sigue existiendo

#### Scenario: Sin endpoints de edición o baja

- **WHEN** se envía `PUT` o `DELETE` a `/api/pacientes/:id/historia-clinica/eventos/:eventoId`
- **THEN** el sistema responde `404` o `405` y el evento no cambia

### Requirement: Validación de entrada de historia clínica

El sistema SHALL responder `400` cuando `tipo` no pertenezca al catálogo, `ocurrido_en` no sea ISO 8601 con zona explícita, `detalle` esté vacío o supere 5000 caracteres, o `turno_id` no exista o no pertenezca al paciente.

#### Scenario: Fecha sin zona horaria explícita

- **WHEN** se envía `ocurrido_en = "2026-11-01T10:00:00"` sin `Z` ni offset
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Detalle vacío

- **WHEN** se envía un evento con `detalle` vacío o solo espacios
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Tipo fuera de catálogo

- **WHEN** se envía un evento con `tipo = "receta"`
- **THEN** el sistema responde `400` y no persiste el evento

#### Scenario: Detalle demasiado largo

- **WHEN** se envía un `detalle` de 5001 caracteres
- **THEN** el sistema responde `400` y no persiste el evento
