# Spec Delta — clinica/acceso-hc

## Purpose

Define quién puede leer o escribir la historia clínica y el odontograma, acotado al profesional tratante o a una delegación temporal auditada, con denegación explícita para recepción y administración.

## ADDED Requirements

### Requirement: Pacientes del profesional

El sistema SHALL autorizar a un usuario `profesional` a leer y escribir la HC y el odontograma de un paciente solo si ese paciente tiene al menos un turno con el `profesional_id` vinculado al usuario, en cualquier estado del turno.

#### Scenario: Turno cancelado habilita el acceso

- **WHEN** el paciente tiene un único turno con el profesional y está en estado `cancelado`
- **THEN** el profesional puede leer la HC y responder `200`

#### Scenario: Paciente sin turno con el profesional

- **WHEN** el paciente no tiene ningún turno con el profesional autenticado
- **THEN** el sistema responde `403` y no devuelve contenido clínico

#### Scenario: Turno con otro profesional

- **WHEN** el paciente solo tiene turnos con un profesional distinto
- **THEN** el sistema responde `403` y no devuelve contenido clínico

### Requirement: Denegación por rol

El sistema SHALL responder `403` a `recepcion` y `administracion` en toda lectura o escritura de historia clínica y odontograma, y `401` cuando falte el token o sea inválido o expirado.

#### Scenario: Recepción no lee la HC

- **WHEN** un usuario `recepcion` solicita `GET /api/pacientes/:id/historia-clinica`
- **THEN** el sistema responde `403` sin nombres, detalle clínico ni eventos

#### Scenario: Administración no escribe la HC

- **WHEN** un usuario `administracion` envía `POST /api/pacientes/:id/historia-clinica/eventos`
- **THEN** el sistema responde `403` y no persiste el evento

#### Scenario: Sin token

- **WHEN** se solicita la HC o el odontograma sin `Authorization: Bearer`
- **THEN** el sistema responde `401`

### Requirement: Delegación temporal de acceso

El sistema SHALL habilitar al profesional delegado mientras la delegación esté vigente (`desde <= ahora < hasta`), con los mismos permisos de lectura y escritura que el titular; al vencer o revocarse SHALL perder el acceso de inmediato.

#### Scenario: Delegado vigente lee y escribe

- **WHEN** existe una delegación vigente del paciente hacia el profesional y el delegado lee la HC y registra un evento
- **THEN** el sistema responde `200` en la lectura y `201` en la escritura

#### Scenario: Delegación vencida

- **WHEN** el delegado intenta leer la HC después de `hasta`
- **THEN** el sistema responde `403` y no devuelve contenido clínico

#### Scenario: Delegación revocada

- **WHEN** la delegación se revoca y el delegado vuelve a solicitar la HC
- **THEN** el sistema responde `403` en el siguiente request

### Requirement: Gestión de delegaciones

El sistema SHALL exponer `POST /api/pacientes/:id/delegaciones-hc` y `DELETE /api/pacientes/:id/delegaciones-hc/:delegacionId`; SHALL permitir otorgarlas al profesional titular y a `administracion`, revocarlas al titular, a `administracion` o al delegado, y devolver solo metadatos, nunca contenido clínico.

#### Scenario: Administración otorga una delegación

- **WHEN** `administracion` crea una delegación con `profesional_id`, `desde`, `hasta` y `motivo` ficticio
- **THEN** el sistema responde `201` con ids, ventana y motivo, y el mismo usuario sigue recibiendo `403` al leer la HC del paciente

#### Scenario: El titular revoca la delegación

- **WHEN** el profesional titular revoca la delegación y el delegado vuelve a leer la HC
- **THEN** el `DELETE` responde `204` y la lectura del delegado responde `403`

#### Scenario: Recepción no gestiona delegaciones

- **WHEN** un usuario `recepcion` intenta crear o revocar una delegación
- **THEN** el sistema responde `403`

#### Scenario: Delegar a un usuario sin profesional

- **WHEN** se intenta delegar a un usuario cuyo `profesional_id` es `null`
- **THEN** el sistema responde `400` y no crea la delegación

#### Scenario: Ventana de delegación inválida

- **WHEN** se crea una delegación con `hasta <= desde`
- **THEN** el sistema responde `400` y no crea la delegación

### Requirement: Identidad profesional resuelta por request

El sistema SHALL resolver el `profesional_id` del usuario desde la base en cada request autenticado; un usuario sin vínculo SHALL recibir `403` en recursos clínicos y la desvinculación SHALL aplicar al siguiente request aunque el token siga vigente.

#### Scenario: Desvinculación con token vigente

- **WHEN** un profesional obtiene un access token, luego `usuario.profesional_id` pasa a `null` y vuelve a solicitar la HC
- **THEN** el sistema responde `403` sin esperar el vencimiento del token

#### Scenario: Usuario sin vínculo profesional

- **WHEN** un usuario con rol `profesional` pero `profesional_id = null` solicita la HC
- **THEN** el sistema responde `403`

### Requirement: No enumeración de pacientes

El sistema SHALL responder el mismo `403` para un paciente inexistente y para uno fuera del alcance del profesional, sin revelar la existencia ni datos del paciente.

#### Scenario: Paciente inexistente y paciente ajeno

- **WHEN** el profesional solicita la HC de un `id` inexistente y la de un paciente real sin turno con él
- **THEN** ambas respuestas son `403` con el mismo cuerpo, sin nombres ni datos clínicos

### Requirement: Autorización de datos clínicos base del paciente

El sistema SHALL permitir `PATCH /api/pacientes/:id` solo con `fecha_nacimiento` para `recepcion`/`administracion` y `alergias` para el profesional con acceso vigente al paciente (titular o delegado); un campo fuera de allowlist SHALL responder `400` y un rol sin permiso sobre el campo `403`.

#### Scenario: Recepción actualiza fecha de nacimiento

- **WHEN** `recepcion` envía `PATCH /api/pacientes/:id` con `fecha_nacimiento` válida
- **THEN** el sistema responde `200`, pero responde `403` si intenta actualizar `alergias`

#### Scenario: Profesional actualiza alergias

- **WHEN** un profesional con acceso vigente envía `PATCH /api/pacientes/:id` con `alergias`
- **THEN** el sistema responde `200`, pero responde `403` si intenta actualizar `fecha_nacimiento`

#### Scenario: Delegado actualiza alergias

- **WHEN** un profesional con delegación vigente envía `PATCH /api/pacientes/:id` con `alergias`
- **THEN** el sistema responde `200`
