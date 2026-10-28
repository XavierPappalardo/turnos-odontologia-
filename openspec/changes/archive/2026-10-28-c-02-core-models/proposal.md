# Proposal: C-02 core-models

## Objetivo
Crear modelos base, migraciones iniciales y seed mínimo para entidades núcleo necesarias para anti-solapamiento (Profesional, SillonBox, Paciente, Prestacion, Turno, Bloqueo, ObraSocialPlan, Pago). Seguir convenciones del proyecto (BaseRepository/UnitOfWork, AuditMixin) y reglas duras.

## Motivación
Es el siguiente paso tras C-01 foundation-setup. Habilita C-03 auth-roles-permisos y es prerequisito crítico para C-04 agenda-turnos-overlaps.

## Alcance
- Modelos con mixins/auditoría
- Repositorios base (BaseRepository[T]) y UnitOfWork
- Migración 001: tablas core con CHECKs/FKs/índices
- Seed mínimo con datos ficticios
- Tests de validación

## Fuera de alcance
- Lógica de solapamientos/anti-solapamiento (va en C-04)
- Auth/RBAC (C-03)
- UI

## Preparación con skill + MCP
- **Skill propia `core-models-scaffolder`**: usada para guiar estructura, migración, índices, seed y tests.
- **MCP filesystem**: usado para consultar `knowledge-base/04-modelos-datos.md`, `05-reglas-negocio.md`, `08-arquitectura.md`, `CHANGES.md` directamente.
