# agenda/bloqueos Specification

## Purpose
Permite a recepción y administración administrar las franjas no reservables de la agenda (por profesional, por sillón o globales), impidiendo que un bloqueo pise turnos activos y liberando el hueco al darlo de baja.

## Requirements

### Requirement: Crear bloqueo de agenda

El sistema SHALL exponer `POST /api/bloqueos` (ruta interna autenticada) que crea un bloqueo y responde `201` con el bloqueo creado, incluyendo `id`, `profesional_id`, `sillon_id`, `inicio`, `fin` y `motivo`. Un bloqueo recién creado aplica de inmediato a las reservas.

#### Scenario: Recepción crea bloqueo por profesional

- **WHEN** un usuario con rol `recepcion` envía `POST /api/bloqueos` con `profesional_id`, `inicio` y `fin` válidos y sin turnos activos intersectados
- **THEN** el sistema responde `201` con el bloqueo persistido y sus campos originales

#### Scenario: Bloqueo recién creado impide reservar

- **WHEN** se crea un bloqueo aplicable de 10:00 a 12:00 y luego se intenta crear un turno de 11:00 a 11:30
- **THEN** el turno se rechaza con `409` y `eje = "bloqueo"`

### Requirement: Globabilidad profesional y sillón

El sistema SHALL aceptar `profesional_id` y `sillon_id` nulos de forma independiente: `profesional_id` nulo aplica a todos los profesionales, `sillon_id` nulo aplica a todos los sillones, y ambos nulos definen un bloqueo global. Cualquier combinación de valor y nulo SHALL ser válida.

#### Scenario: Bloqueo global aplica a cualquier profesional y sillón

- **WHEN** existe un bloqueo con `profesional_id = null` y `sillon_id = null` de 10:00 a 12:00 y se intenta reservar cualquier profesional en cualquier sillón a las 11:00
- **THEN** el sistema rechaza el turno con `409` y `eje = "bloqueo"`

#### Scenario: Bloqueo por sillón no afecta a otros sillones

- **WHEN** existe un bloqueo del sillón 1 de 10:00 a 12:00 y se intenta reservar el sillón 2 a las 11:00
- **THEN** el sistema permite el turno con `201`

### Requirement: Rechazo de bloqueo sobre turnos activos

El sistema SHALL rechazar con `409`, `eje = "bloqueo"` y la lista de `turno_id` en conflicto (solo ids opacos, sin PHI) toda creación o edición de bloqueo cuyo intervalo `[inicio, fin)` intersecte un turno activo (`reservado`, `confirmado`, `presente`) aplicable, evaluado como `turno.inicio < bloqueo.fin AND turno.fin > bloqueo.inicio`. El bloqueo SHALL NOT persistirse ni modificarse.

#### Scenario: Alta de bloqueo sobre turno activo rechazada

- **WHEN** existe un turno `confirmado` de 10:00 a 10:30 y se intenta crear un bloqueo aplicable de 09:00 a 11:00
- **THEN** el sistema responde `409` con `eje = "bloqueo"` y el `turno_id` en conflicto, y no crea el bloqueo

#### Scenario: Edición que pisa un turno activo rechazada

- **WHEN** existe un bloqueo de 08:00 a 09:00 y un turno activo de 10:00 a 10:30, y se edita el bloqueo para cubrir 09:30 a 10:15
- **THEN** el sistema responde `409` con `eje = "bloqueo"` y el bloqueo conserva su intervalo original

#### Scenario: Turnos cancelados no impiden bloquear

- **WHEN** el único turno del intervalo está en estado `cancelado`, `ausente` o `atendido` y se crea un bloqueo que lo cubre
- **THEN** el sistema responde `201`

### Requirement: Listado de bloqueos con filtros

El sistema SHALL exponer `GET /api/bloqueos` (ruta interna autenticada) que devuelve los bloqueos no eliminados y SHALL aceptar los filtros opcionales `profesional_id`, `sillon_id`, `desde` y `hasta` sobre el rango de fechas. Sin filtros SHALL devolver todos los bloqueos vigentes.

#### Scenario: Listado filtrado por profesional y rango

- **WHEN** se solicita `GET /api/bloqueos?profesional_id=<id>&desde=<inicio>&hasta=<fin>`
- **THEN** el sistema responde `200` con solo los bloqueos de ese profesional que intersectan el rango pedido

#### Scenario: Bloqueos eliminados no aparecen en el listado

- **WHEN** un bloqueo fue dado de baja lógicamente y se solicita `GET /api/bloqueos`
- **THEN** la respuesta `200` no incluye ese bloqueo

### Requirement: Edición de bloqueo

El sistema SHALL exponer `PUT /api/bloqueos/:id` (ruta interna autenticada) que reemplaza los campos editables del bloqueo y responde `200` con el bloqueo actualizado. Un `id` inexistente o ya eliminado SHALL responder `404`. La edición SHALL revalidar intersección contra turnos activos con las mismas reglas que el alta.

#### Scenario: Edición válida de un bloqueo

- **WHEN** recepción envía `PUT /api/bloqueos/:id` con un nuevo rango sin turnos activos intersectados
- **THEN** el sistema responde `200` con el rango actualizado

#### Scenario: Edición de bloqueo inexistente

- **WHEN** se envía `PUT /api/bloqueos/:id` con un `id` que no existe
- **THEN** el sistema responde `404` sin crear un bloqueo nuevo

### Requirement: Baja lógica de bloqueo

El sistema SHALL exponer `DELETE /api/bloqueos/:id` (ruta interna autenticada) que marca el bloqueo con `deleted_at` y responde `204`, sin borrar la fila. Un `id` inexistente o ya eliminado SHALL responder `404`. Un bloqueo eliminado SHALL NOT volver a aplicar a reservas.

#### Scenario: Baja de bloqueo libera el hueco

- **WHEN** existe un bloqueo aplicable de 10:00 a 12:00, se da de baja con `DELETE /api/bloqueos/:id` y luego se intenta crear un turno de 11:00 a 11:30
- **THEN** el `DELETE` responde `204`, la fila conserva su `deleted_at` y el turno se crea con `201`

#### Scenario: Segunda baja del mismo bloqueo

- **WHEN** se repite `DELETE /api/bloqueos/:id` sobre un bloqueo ya eliminado
- **THEN** el sistema responde `404` y no modifica nuevamente `deleted_at`

### Requirement: Validación de entrada de bloqueo

El sistema SHALL responder `400` cuando `fin <= inicio`, cuando falte un campo obligatorio, cuando `inicio` o `fin` no sean ISO 8601 UTC con zona horaria explícita, o cuando un `profesional_id`/`sillon_id` no nulo no exista o no esté activo.

#### Scenario: Rango inválido rechazado

- **WHEN** se envía `POST /api/bloqueos` con `fin <= inicio`
- **THEN** el sistema responde `400` y no persiste el bloqueo

#### Scenario: Profesional inexistente rechazado

- **WHEN** se envía `POST /api/bloqueos` con un `profesional_id` que no existe o está inactivo
- **THEN** el sistema responde `400` y no persiste el bloqueo

#### Scenario: Fecha sin zona horaria explícita rechazada

- **WHEN** se envía `POST /api/bloqueos` con `inicio = "2026-12-01T10:00:00"` sin `Z` ni offset
- **THEN** el sistema responde `400` y no persiste el bloqueo

### Requirement: Autorización de gestión y lectura de bloqueos

El sistema SHALL permitir gestionar bloqueos (`POST`, `PUT`, `DELETE`) y leerlos (`GET`) solo a `recepcion` y `administracion`; un `profesional` SHALL recibir `403` en los cuatro métodos. La lectura no se acota por query param: `recepcion` y `administracion` ven todos los bloqueos vigentes.

#### Scenario: Profesional no gestiona bloqueos

- **WHEN** un usuario con rol `profesional` envía `POST`, `PUT` o `DELETE` sobre `/api/bloqueos`
- **THEN** el sistema responde `403` y no modifica bloqueos

#### Scenario: Profesional no lee bloqueos

- **WHEN** un usuario con rol `profesional` solicita `GET /api/bloqueos`
- **THEN** el sistema responde `403` y no devuelve bloqueos

### Requirement: Privacidad en errores de bloqueos

El sistema SHALL NOT incluir PHI (nombres, DNI, historia clínica, teléfonos) en respuestas de error, logs ni query params de bloqueos: solo ids opacos internos y `eje`.

#### Scenario: Conflicto sin PHI

- **WHEN** se rechaza un bloqueo por intersección con turnos activos
- **THEN** la respuesta `409` contiene solo `turno_id` opacos y `eje`, sin nombres, DNI ni teléfonos
