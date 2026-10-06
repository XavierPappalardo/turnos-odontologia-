# Spec — agenda/crear-turno

## Purpose

Permite a recepción crear turnos internos sin doble reserva, validando en tiempo de escritura que ni el profesional ni el sillón/box se solapen y que no exista bloqueo aplicable.

## Requirements

### Requirement: Crear turno válido interno

El sistema SHALL exponer `POST /api/turnos` (ruta interna autenticada) que crea un turno en estado `reservado` y responde `201` con el turno creado cuando el profesional y el sillón están libres y no hay bloqueo aplicable. Autenticación y roles provistos por C-03 [Supuesto].

#### Scenario: Recepción crea turno con profesional y sillón libres

- **WHEN** un rol autorizado envía `POST /api/turnos` con `profesional_id`, `sillon_id`, `paciente_id`, `inicio` y `fin` válidos (`fin > inicio`, sin intersección activa ni bloqueo aplicable)
- **THEN** el sistema responde `201` con el turno en estado `reservado`

### Requirement: Anti-solapamiento por profesional

El sistema SHALL rechazar con `409` y `eje = "profesional"` todo turno cuyo intervalo `[inicio, fin)` intersecte otro turno del mismo `profesional_id` en estado activo (`reservado`, `confirmado`, `presente`), evaluado como `existente.inicio < nuevo_fin AND existente.fin > nuevo_inicio`.

#### Scenario: Solape parcial por profesional rechazado

- **WHEN** existe un turno activo del mismo profesional de 10:00 a 10:30 y se intenta crear otro de 10:15 a 10:45 para ese profesional (sillón distinto)
- **THEN** el sistema responde `409` con `eje = "profesional"` y no persiste el turno

#### Scenario: Turno contenido por profesional rechazado

- **WHEN** existe un turno activo del mismo profesional de 10:00 a 11:00 y se intenta crear otro de 10:15 a 10:30 para ese profesional
- **THEN** el sistema responde `409` con `eje = "profesional"` y no persiste el turno

### Requirement: Anti-solapamiento por sillón/box

El sistema SHALL rechazar con `409` y `eje = "sillon"` todo turno cuyo intervalo `[inicio, fin)` intersecte otro turno del mismo `sillon_id` en estado activo, con la misma fórmula de intersección. Ambos ejes se evalúan de forma independiente (AND lógico: basta un eje en conflicto para rechazar).

#### Scenario: Solape por sillón con profesional distinto rechazado

- **WHEN** existe un turno activo en el sillón 1 de 10:00 a 10:30 y se intenta crear otro en el sillón 1 de 10:15 a 10:45 con otro profesional
- **THEN** el sistema responde `409` con `eje = "sillon"` y no persiste el turno

### Requirement: Intervalos contiguos permitidos

El sistema SHALL permitir turnos adyacentes donde `nuevo.inicio == existente.fin` (o viceversa), porque el intervalo es semiabierto `[inicio, fin)`.

#### Scenario: Turno contiguo al anterior permitido

- **WHEN** existe un turno activo de 10:00 a 10:30 y se crea otro de 10:30 a 11:00 con el mismo profesional y sillón
- **THEN** el sistema responde `201` con el turno en estado `reservado`

### Requirement: Estados que liberan agenda

El sistema SHALL ignorar en la validación de solapamiento los turnos en estado `cancelado`, `ausente` o `atendido`: un hueco ocupado solo por esos estados se considera libre.

#### Scenario: Hueco de turno cancelado reutilizable

- **WHEN** existe un turno `cancelado` de 10:00 a 10:30 y se crea un turno nuevo en el mismo profesional, sillón e intervalo
- **THEN** el sistema responde `201` con el turno en estado `reservado`

### Requirement: Validación contra bloqueos

El sistema SHALL rechazar con `409` y `eje = "bloqueo"` todo turno que intersecte un bloqueo aplicable (mismo `profesional_id` o NULL global; mismo `sillon_id` o NULL global) con la misma fórmula de intersección. La tabla `Bloqueo` es de solo lectura en este change (su CRUD pertenece a C-08).

#### Scenario: Reserva sobre bloqueo vigente rechazada

- **WHEN** existe un bloqueo aplicable al profesional (o sillón, o global) de 10:00 a 12:00 y se intenta crear un turno intersectado de 11:00 a 11:30
- **THEN** el sistema responde `409` con `eje = "bloqueo"` y no persiste el turno

### Requirement: Validación de entrada

El sistema SHALL responder `400` cuando `fin <= inicio`, cuando falte un campo obligatorio, cuando un FK no exista o cuando el formato de fecha no sea ISO 8601 UTC.

#### Scenario: Fin anterior a inicio rechazado

- **WHEN** se envía `POST /api/turnos` con `fin <= inicio`
- **THEN** el sistema responde `400` y no persiste el turno

### Requirement: Autorización y privacidad en errores

El sistema SHALL responder `403` a roles sin permiso de creación de turnos ([Supuesto] matriz RBAC de C-03: recepción/administración crean; profesional no configura agenda ajena) y SHALL NOT incluir PHI (nombres, DNI, historia clínica, teléfonos) en cuerpos de error, logs ni query params: los errores identifican recursos solo con UUIDs/ids opacos internos más el campo `eje`.

#### Scenario: Rol sin permiso rechazado sin PHI

- **WHEN** un rol no autorizado intenta `POST /api/turnos`
- **THEN** el sistema responde `403` sin exponer datos de pacientes en el cuerpo, log o URL

#### Scenario: Conflicto 409 sin PHI

- **WHEN** se rechaza un turno por solapamiento
- **THEN** la respuesta `409` contiene solo ids opacos y `eje`, sin nombres ni DNI ni teléfonos

### Requirement: Atomicidad ante concurrencia

El sistema SHALL garantizar que dos creaciones concurrentes sobre el mismo profesional/sillón e intervalo no produzcan doble reserva: una tiene éxito (`201`) y la otra es rechazada (`409`), mediante transacción de escritura `BEGIN IMMEDIATE` que abarca la consulta de intersección y la inserción ([Supuesto] motor SQLite y migraciones base de C-01/C-02).

#### Scenario: Doble escritura concurrente sin doble reserva

- **WHEN** dos solicitudes concurrentes intentan crear un turno para el mismo profesional y sillón en el mismo intervalo
- **THEN** una recibe `201` y la otra `409`, y persiste un único turno activo en ese hueco
