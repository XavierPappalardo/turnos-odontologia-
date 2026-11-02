# Spec Delta — platform/auditoria-phi

## Purpose

Registra de forma append-only todo acceso a datos clínicos para permitir auditoría y detección de accesos indebidos, sin almacenar PHI en el propio registro.

## ADDED Requirements

### Requirement: Registro de accesos clínicos

El sistema SHALL insertar exactamente una fila en `auditoria_phi` por cada lectura o escritura de HC, odontograma o datos clínicos del paciente, con `ocurrido_en`, `usuario_id`, `rol`, `paciente_id`, `recurso`, `recurso_id`, `accion` (`leer`, `crear`, `editar`, `exportar`, `imprimir`), `resultado`, `ip` y `session_id`; la inserción SHALL ocurrir en la misma transacción que la operación.

#### Scenario: Lectura autorizada deja una fila

- **WHEN** un profesional con acceso lee la HC del paciente
- **THEN** existe exactamente una fila nueva con `accion = "leer"`, `resultado = "permitido"`, `recurso = "historia_clinica"` y el `paciente_id` correspondiente

#### Scenario: Escritura y auditoría en el mismo commit

- **WHEN** se registra un evento de odontograma
- **THEN** el evento y la fila de auditoría con `accion = "crear"` existen ambos, o no existe ninguno

#### Scenario: Validación fallida no audita como permitido

- **WHEN** un evento de HC se rechaza con `400`
- **THEN** no queda una fila de auditoría con `resultado = "permitido"` para ese intento

#### Scenario: Actualización de datos clínicos del paciente

- **WHEN** un profesional con acceso actualiza `alergias` del paciente
- **THEN** se inserta una fila con `recurso = "paciente"`, `accion = "editar"` y `resultado = "permitido"`

### Requirement: Auditoría de delegaciones

El sistema SHALL registrar cada alta y revocación de delegación con `recurso = "delegacion_hc"`, `accion = "crear"` o `"editar"` y `resultado`, sin contenido clínico.

#### Scenario: Alta de delegación auditada

- **WHEN** `administracion` otorga una delegación
- **THEN** se inserta una fila con `recurso = "delegacion_hc"`, `accion = "crear"` y `resultado = "permitido"`

#### Scenario: Revocación auditada

- **WHEN** el titular revoca una delegación
- **THEN** se inserta una fila con `recurso = "delegacion_hc"`, `accion = "editar"` y `resultado = "permitido"`

### Requirement: Registro de accesos denegados

El sistema SHALL registrar todo `403` sobre recursos clínicos con `resultado = "denegado"` y `motivo` (`sin_vinculo`, `rol_no_autorizado`, `delegacion_vencida`), sin contenido clínico.

#### Scenario: Profesional sin turno

- **WHEN** un profesional sin turno con el paciente intenta leer la HC
- **THEN** se inserta una fila con `resultado = "denegado"` y `motivo = "sin_vinculo"`

#### Scenario: Rol no autorizado

- **WHEN** un usuario `recepcion` intenta leer la HC
- **THEN** se inserta una fila con `resultado = "denegado"` y `motivo = "rol_no_autorizado"`

#### Scenario: Delegación vencida

- **WHEN** un delegado con ventana vencida intenta leer la HC
- **THEN** se inserta una fila con `resultado = "denegado"` y `motivo = "delegacion_vencida"`

### Requirement: Auditoría insert-only

La tabla `auditoria_phi` SHALL ser insert-only; triggers `BEFORE UPDATE` y `BEFORE DELETE` SHALL abortar cualquier modificación o borrado de filas.

#### Scenario: UPDATE rechazado por trigger

- **WHEN** se intenta modificar una fila de `auditoria_phi` con SQL directo
- **THEN** SQLite aborta la operación y la fila conserva sus valores

#### Scenario: DELETE rechazado por trigger

- **WHEN** se intenta borrar una fila de `auditoria_phi` con SQL directo
- **THEN** SQLite aborta la operación y la cantidad de filas no cambia

### Requirement: Auditoría sin PHI

Las filas de `auditoria_phi` SHALL NOT contener nombres, DNI, teléfonos, texto clínico ni motivos de consulta; solo ids opacos, códigos de recurso/acción y motivos de autorización.

#### Scenario: La fila no filtra el contenido clínico

- **WHEN** se lee la HC de un paciente ficticio llamado "Paciente Ficticio" con un `detalle` clínico reconocible
- **THEN** la fila de auditoría no contiene ese nombre ni ese `detalle`

### Requirement: Identificación opaca de sesión

El sistema SHALL identificar la sesión de cada fila con un `session_id` opaco derivado del access token vigente y SHALL NOT almacenar el token ni parte de su firma.

#### Scenario: Mismo token, mismo session_id

- **WHEN** se realizan dos lecturas con el mismo access token
- **THEN** ambas filas comparten `session_id` y ese valor no coincide con el token

#### Scenario: Token renovado cambia la sesión

- **WHEN** se renueva el access token y se realiza otra lectura
- **THEN** la nueva fila tiene un `session_id` distinto
