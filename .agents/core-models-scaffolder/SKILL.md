---
name: core-models-scaffolder
description: Scaffolds C-02 core-models for turnos-odontologia following project conventions (BaseRepository/UnitOfWork, AuditMixin, SQLite migrations with CHECKs/indexes for overlaps, seed mínimo, Dado/Cuando/Entonces tests). Use when preparing or implementing C-02 core-models or creating entities/migrations for Turno/Profesional/SillonBox/Paciente/Prestacion/Bloqueo/ObraSocialPlan/Pago.
---

# Core Models Scaffolder

## Propósito
Guiar la creación/scaffolding de modelos base para C-02 siguiendo las convenciones del proyecto y reglas duras (R2,R5,R6,R8,R9,R11).

## Cuándo activar
- Al preparar/implementar `C-02 core-models`
- Al crear entidades/migraciones para Turno, Profesional, SillonBox, Paciente, Prestacion, Bloqueo, ObraSocialPlan, Pago

## Entradas necesarias
- `knowledge-base/04-modelos-datos.md`
- `knowledge-base/05-reglas-negocio.md`
- `knowledge-base/08-arquitectura.md`
- `CHANGES.md`
- Estructura actual del repo

## Procedimiento
1. Leer KB y reglas duras
2. Identificar entidades requeridas para C-02
3. Proponer estructura con AuditMixin, BaseRepository[T], UnitOfWork
4. Generar migración 001 con CHECKs: `fin > inicio`, `duracion_min > 0`, `cobertura_pct BETWEEN 0 AND 100`, `monto_centavos >= 0`; índices `(profesional_id,inicio,fin)`, `(sillon_id,inicio,fin)`
5. Sugerir seed mínimo (1 profesional, 1 sillón, 1 prestación, 1 obra social plan, 1 paciente)
6. Generar tests Dado/Cuando/Entonces para validación de CHECKs y estructura
7. Verificar reglas anti-solapamiento (RN-01/RN-02/RN-04)

## Resultado esperado
Checklist accionable + esqueleto de archivos (modelos/migraciones/repos) consistente con convenciones, listo para `/opsx:apply`.

## Criterios de revisión
- Usa `monto_centavos INTEGER` (sin floats)
- Incluye índices para solapamiento
- Aplica BaseRepository/UnitOfWork
- Respeta estados y RN-01/RN-02/RN-04
- Tests con escenarios Dado/Cuando/Entonces
