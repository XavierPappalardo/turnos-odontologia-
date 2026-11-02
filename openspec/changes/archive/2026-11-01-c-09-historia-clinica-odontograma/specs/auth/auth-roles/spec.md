# Spec Delta — auth/auth-roles

## ADDED Requirements

### Requirement: Identidad profesional del usuario

El sistema SHALL persistir `usuario.profesional_id` como FK nullable y única hacia `profesional`, SHALL exponerlo como `profesional_id` (o `null`) en `GET /api/auth/me`, y SHALL resolverlo desde la base en cada request en lugar de depender de un claim del JWT.

#### Scenario: Usuario vinculado a un profesional

- **WHEN** un usuario con `profesional_id` definido consulta `GET /api/auth/me`
- **THEN** la respuesta `200` incluye ese `profesional_id` y no incluye datos clínicos ni PHI

#### Scenario: Usuario sin vínculo profesional

- **WHEN** un usuario sin `profesional_id` consulta `GET /api/auth/me`
- **THEN** la respuesta `200` devuelve `profesional_id: null`

#### Scenario: Un profesional no se comparte entre usuarios

- **WHEN** se intenta asignar el mismo `profesional_id` a un segundo usuario, o asignar un `profesional_id` inexistente
- **THEN** SQLite rechaza la escritura por UNIQUE o por FK

#### Scenario: Desvinculación inmediata

- **WHEN** un usuario obtiene un access token, luego se le quita el `profesional_id` y vuelve a llamar una ruta clínica
- **THEN** el sistema ya no lo trata como profesional vinculado, aunque el token siga vigente

### Requirement: Autorización clínica por vínculo, no solo por rol

El sistema SHALL evaluar las rutas clínicas con autenticación Bearer y autorización por vínculo profesional; SHALL NOT autorizar por la mera presencia del rol `profesional`.

#### Scenario: Rol profesional sin vínculo no autoriza

- **WHEN** un usuario con rol `profesional` pero sin `profesional_id` solicita un recurso clínico
- **THEN** el sistema responde `403` y no ejecuta la operación

#### Scenario: Rol ajeno a la clínica no autoriza

- **WHEN** un usuario `recepcion` o `administracion` solicita un recurso clínico
- **THEN** el sistema responde `403` y no ejecuta la operación
