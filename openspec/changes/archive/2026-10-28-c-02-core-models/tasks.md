# Tasks: C-02 core-models

## Preparación
- [x] Consultar KB (`04-modelos-datos.md`, `05-reglas-negocio.md`, `08-arquitectura.md`)
- [x] Aplicar guía de `core-models-scaffolder`

## Implementación
- [x] Crear modelos con AuditMixin (`created_at`, `updated_at`, `deleted_at`, `activo`)
- [x] Crear `BaseRepository[T]` y `UnitOfWork` (`BEGIN IMMEDIATE`)
- [x] Migración 001 con tablas, CHECKs, FKs, índices
- [x] Migración 004 de completitud: `obra_social_plan`, `pago`, auditoría/soft-delete
- [x] Seed mínimo idempotente (datos ficticios)
- [x] Repositorios `ObraSocialPlanRepository` y `PagoRepository`
- [x] Tests `Dado/Cuando/Entonces` (`tests/core_models.test.ts`)

## Verificación
- [x] Escenario 1 (funcionamiento esperado): entidades persisten con FKs/defaults
- [x] Escenario 2 (error de negocio): `fin <= inicio` rechazado por CHECK
- [x] Escenario 3 (borde): `duracion_min = 0` rechazado
- [x] `monto_centavos` entero >= 0 + `moneda='ARS'` (R2/R5)
- [x] `cobertura_pct` entero 0..100 (R6)
- [x] Seed idempotente sin datos reales (R1/R12)
- [x] `npm run typecheck` + `npm test` verdes
