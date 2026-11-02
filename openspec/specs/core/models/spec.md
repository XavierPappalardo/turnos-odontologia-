# Spec Delta — core/models

## MODIFIED Requirements

### Requirement: Entidades core y auditoría

El sistema SHALL persistir `profesional`, `sillon`, `paciente`, `prestacion`, `obra_social_plan`, `turno`, `bloqueo` y `pago`, todas con `created_at`/`updated_at` y soft-delete `deleted_at`; `paciente` y `prestacion` SHALL además exponer `activo` (0/1) y `paciente` SHALL exponer `fecha_nacimiento` y `alergias`, ambas nullable.

#### Scenario: Esquema completo tras migraciones

- **WHEN** se abre una base con `openDatabase` (migraciones 001→008)
- **THEN** existen las ocho tablas core con sus columnas de auditoría y `paciente` tiene las columnas `fecha_nacimiento` y `alergias`

#### Scenario: Paciente sin datos clínicos base

- **WHEN** se inserta un paciente ficticio sin `fecha_nacimiento` ni `alergias`
- **THEN** la fila se persiste con ambas columnas en `NULL`

## ADDED Requirements

### Requirement: Actualización de datos clínicos base del paciente

El sistema SHALL exponer `PATCH /api/pacientes/:id` que acepta únicamente `fecha_nacimiento` (fecha `YYYY-MM-DD` no futura, nullable) y `alergias` (texto libre nullable, máximo 2000 caracteres); SHALL responder `400` ante otro campo o valor inválido y `404` si el paciente no existe o está eliminado.

#### Scenario: Actualización parcial válida

- **WHEN** se envía `PATCH /api/pacientes/:id` solo con `fecha_nacimiento` válida
- **THEN** el sistema responde `200` con ese valor actualizado y conserva `alergias` sin cambios

#### Scenario: Fecha de nacimiento futura

- **WHEN** se envía una `fecha_nacimiento` posterior a la fecha actual
- **THEN** el sistema responde `400` y no modifica el paciente

#### Scenario: Campo fuera de allowlist

- **WHEN** se envía `PATCH /api/pacientes/:id` con `nombre` junto a un campo permitido
- **THEN** el sistema responde `400` y no modifica ningún campo

#### Scenario: Alergias demasiado largas

- **WHEN** se envían `alergias` de 2001 caracteres
- **THEN** el sistema responde `400` y no modifica el paciente

#### Scenario: Paciente inexistente o eliminado

- **WHEN** `administracion` envía `PATCH /api/pacientes/:id` con un `id` inexistente o con `deleted_at` no nulo
- **THEN** el sistema responde `404` y no crea ni revive pacientes
