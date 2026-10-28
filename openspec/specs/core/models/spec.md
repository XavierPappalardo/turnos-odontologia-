# Spec — core/models

## Purpose

Define las entidades base del dominio odontológico con auditoría, restricciones de integridad y repositorios, incluyendo reglas monetarias en centavos ARS y porcentajes enteros, para sostener agenda, caja y obras sociales sin datos reales.

## Requirements

### Requirement: Entidades core y auditoría

El sistema SHALL persistir `profesional`, `sillon`, `paciente`, `prestacion`, `obra_social_plan`, `turno`, `bloqueo` y `pago`, todas con `created_at`/`updated_at` y soft-delete `deleted_at`; `paciente` y `prestacion` SHALL además exponer `activo` (0/1).

#### Scenario: Esquema completo tras migraciones

- **WHEN** se abre una base con `openDatabase` (migraciones 001→005)
- **THEN** existen las ocho tablas core con sus columnas de auditoría

### Requirement: Integridad de turnos

El sistema SHALL rechazar a nivel SQLite un turno con `fin <= inicio` y SHALL mantener las FKs de profesional, sillón, paciente y prestación.

#### Scenario: Turno con fin anterior a inicio

- **WHEN** se inserta un turno con `fin <= inicio`
- **THEN** SQLite rechaza la escritura por CHECK

### Requirement: Prestaciones con duración positiva

El sistema SHALL exigir `prestacion.duracion_min` entero mayor que cero.

#### Scenario: Duración cero rechazada

- **WHEN** se inserta una prestación con `duracion_min = 0`
- **THEN** SQLite rechaza la escritura

### Requirement: Cobertura de obra social exacta

El sistema SHALL modelar `obra_social_plan.cobertura_pct` como entero entre 0 y 100 inclusive, rechazando fracciones y valores fuera de rango. `(obra_social, plan)` SHALL ser único.

#### Scenario: Cobertura válida en bordes

- **WHEN** se inserta `cobertura_pct` 0 o 100
- **THEN** la fila se persiste

#### Scenario: Cobertura inválida

- **WHEN** se inserta `cobertura_pct` -1, 101 o 50.5
- **THEN** SQLite rechaza la escritura

### Requirement: Montos en centavos ARS

El sistema SHALL modelar `pago.monto_centavos` como entero no negativo y `moneda = 'ARS'`; SHALL aceptar solo los medios `efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`, y los estados `pendiente`, `cobrado`, `anulado`. La conversión a decimales ocurre únicamente en presentación.

#### Scenario: Monto negativo, fraccionario o moneda distinta

- **WHEN** se inserta un pago con monto negativo, `10.5`, moneda `USD` o medio desconocido
- **THEN** SQLite rechaza la escritura

#### Scenario: Total cobrado por turno

- **WHEN** un turno tiene pagos `cobrado` y `pendiente`
- **THEN** `PagoRepository.totalCobradoPorTurno` suma solo los `cobrado`, en centavos

### Requirement: Repositorios y unidad de trabajo

El sistema SHALL acceder a datos solo vía `BaseRepository<T>`/`UnitOfWork`; SHALL ofrecer `insert`/`insertOrIgnore`, `AuditMixin` (`auditStamp`, `softDeleteStamp`) y repositorios `ObraSocialPlanRepository` y `PagoRepository`.

#### Scenario: Seed idempotente

- **WHEN** se ejecuta `seedMinimo` dos veces
- **THEN** cada entidad ficticia queda con una sola fila

### Requirement: Datos ficticios

El sistema SHALL usar exclusivamente datos ficticios en seeds y fixtures; SHALL NOT incluir nombres, DNI, teléfonos ni historias clínicas reales.

#### Scenario: Seed sin datos reales

- **WHEN** se inspecciona el seed
- **THEN** nombres, matrícula y teléfono contienen marcadores ficticios y el paciente referencia el plan de obra social ficticio
