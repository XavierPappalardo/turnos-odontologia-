# Proposal: C-04 agenda-turnos-overlaps

## Objetivo
Crear turnos evitando solapamientos por profesional AND por sillón/box, con reglas verificables y máquina de estados.

## Alcance (MANDATORIO)
- Lógica anti-solapamiento (RN-01, RN-02)
- Validación vs Bloqueos (RN-04)
- Transacciones `BEGIN IMMEDIATE` (SQLite)
- Endpoint `POST /api/turnos` (JWT + RBAC)
- Máquina de estados mínima + `PATCH /api/turnos/:id/estado`
- Migración 003 (turno/bloqueo) + índices
- Tests obligatorios de solapamiento y estados

## Dependencias
C-03 auth-roles-permisos

## Resultado
Implementado y verificado con `tests/crear_turno.test.ts` (20 escenarios) y
`tests/turno_estado.test.ts` (20 escenarios), sobre SQLite real.

## Preparación
Skill `core-models-scaffolder` + KB (`04-modelos-datos.md`, `05-reglas-negocio.md`, `07-flujos.md`).
