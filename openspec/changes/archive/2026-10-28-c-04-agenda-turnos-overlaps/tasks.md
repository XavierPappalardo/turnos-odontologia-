# Tasks: C-04 agenda-turnos-overlaps

## Preparación
- [x] Consultar KB (`04-modelos-datos.md`, `05-reglas-negocio.md`, `07-flujos.md`)
- [x] Revisar implementación previa como referencia

## Implementación
- [x] Lógica anti-solapamiento por profesional y sillón (`inicio < nuevo_fin AND fin > nuevo_inicio`)
- [x] Validación contra bloqueos aplicables (profesional/sillón/global)
- [x] Transacción `BEGIN IMMEDIATE` envolviendo consulta + inserción
- [x] Endpoint `POST /api/turnos` con JWT + RBAC (recepción/administración)
- [x] Migración 003 (turno/bloqueo) + índices de solapamiento
- [x] Máquina de estados y `PATCH /api/turnos/:id/estado`
- [x] Tests obligatorios (`tests/crear_turno.test.ts`, `tests/turno_estado.test.ts`)

## Verificación
- [x] Profesional overlap → `409 {eje:"profesional"}`
- [x] Sillón/box overlap → `409 {eje:"sillon"}`
- [x] Sin overlap / intervalos contiguos → `201`
- [x] Bloqueos → `409 {eje:"bloqueo"}`
- [x] Cancelación libera hueco → nuevo turno `201`
- [x] Doble escritura concurrente → un `201` + un `409`
- [x] Transiciones válidas de KB-04 §9 y rechazo `409` de las inválidas
- [x] `npm run typecheck` + `npm test` verdes (SQLite real, R9/R11/R12)
