---
schema: spec-driven
created: 2026-11-06
---
# Proposal — C-13 `comisiones-profesional`

## Why

1. Objetivo de negocio (CHANGES.md C-13 / F-09 / CU-7): liquidar comisiones por profesional según RN-08 — "% general o por tratamiento, con vista previa antes de confirmar". Fuentes del owner (DentalSoft, 2026-10-06) caracterizan el mecanismo, no el detalle: aquí se especifica y acota.
2. Rutina → flujo manual no trazable: hoy la producción cobrada por profesional existe en el modelo (pagos `cobrado` vinculados a turnos/presupuestos del profesional, C-11) pero no hay configuración de porcentajes, ni cálculo agregado, ni liquidación confirmable con historial auditable, ni vista previa.
3. Gobernanza y reglas duras: MEDIO (R16); sujeta a R2/R5 (centavos enteros), R6 (% enteros 0..100), R3 (logs sin PHI), R4 (recepción NO configura comisiones; profesional solo ve las suyas), R8/R12 (repositorios + transacciones reales), R14 (este change via `/opsx:propose → apply → archive`).

## What Changes

Un capability nuevo `comisiones` con 12 Requirements (deltas ADDED-only; sin modificar los specs existentes de C-07/C-11/C-12) — resumidos aquí en 11 puntos, el detalle normativo vive en el spec delta:

1. Configuración de comisión: % general por profesional y % por tratamiento (por prestación, por profesional) — administración exclusiva (R4).
2. Cálculo sobre **producción cobrada**: solo pagos `cobrado` atribuibles al profesional vía turno; parciales naturalmente soportados (línea por cobro); pagos anulados/pendientes, turnos no `atendido` y medio `obra_social` excluidos de la base (Q1/Q2 ratificadas, 2026-11-06); comisión por ítem truncada a piso (Q5 ratificada).
3. Primer fiscal del período: la **fecha contable de caja** (`movimiento_caja.fecha_contable`, RN-09) del cobro delimita `[desde, hasta]` (Q3 ratificada, 2026-11-06).
4. Prioridad: si existe % específico para (profesional, prestación del turno) se aplica ese, si no el general (RN-08).
5. Liquidación: generación de borrador con ítems-snapshot inmutables + cabecera con total exacto, exclusiva por (profesional, período) y **un cobro solo puede aparecer en una liquidación vigente** (anti doble-pago), con evento append-only `generada`. Q7 ratificada: períodos solapados permitidos; el cobro sigue siendo único (no doble comisión).
6. Confirmación administrativa: transición única `borrador → confirmada` (terminal), re-verificación completa del cálculo dentro de una transacción `BEGIN IMMEDIATE` (patrón C-12/F1 + fingerprint D13) y evento append-only `confirmada`.
7. Consultas: administración consulta/configura todo; profesional consulta **solo sus liquidaciones confirmadas propias** con scoping forzado por backend (R4; Q6 ratificada).
8. Ajustes compensatorios (Q4 ratificada): la anulación de un cobro cuya comisión ya radica en una liquidación confirmada genera un ajuste negativo en la PRÓXIMA liquidación del profesional, vinculado por `item_origen_id` + `pago_id`, trazable; la reserva es exclusiva y transaccional (un ajuste nunca pertenece a dos borradores activos: liberado al descartar, consumido al confirmar); si los ajustes superan los ítems, se confirma igualmente registrando `saldo_compensacion_centavos` que se arrastra a períodos posteriores — sin pagos negativos automáticos; la confirmada original nunca se modifica.
9. Fingerprint del cálculo: `preview` responde un hash determinista y `generar`/`regenerar`/`confirmar` lo exigen en el body; toda divergencia entre lo revisado y lo vivo → `409 preview_desactualizado` (lo confirmado es idéntico a lo revisado).
10. Migración 012: 6 tablas nuevas (config general, config por tratamiento, liquidación, ítems, ajustes, eventos) + índices + triggers insert-only.
11. Historial y trazabilidad: eventos append-only con actor/fecha; snapshots por ítem preservan el cálculo vigente al confirmar.

Fuera de alcance: cambiar `item_presupuesto` y la atribución fina por ítems de presupuesto (sin FK verificable a `prestacion`; deferida a C-15 — P1 concluye que NO requiere ampliar el scope de C-13), anticipos por producción pendiente, tablero del dueño; la edición retroactiva de una liquidación confirmada (la compensación por ajustes ES in-scope: D12/Q4 ratificada).

## Impact

- **Specs**: `openspec/specs/comisiones/spec.md` (CREATE al aplicar — 12 Requirements).
- **Código** (en fase `/opsx:apply`): `backend/src/comisiones/` (nuevo módulo: configuraciones/liquidaciones repositories + services + routes), extensiones mínimas read-only en `backend/src/core/pago.repository.ts` (nuevo query de cobros elegibles) y `backend/src/core/models.ts`; `shared/types.ts` + `shared/auth.ts` (ROLES_COM_*) + `shared/errors.ts` (ComisionErrorCode) + `shared/app.ts` (1 router); `shared/migrations.ts` (MIGRATION_012 para el registro).
- **Tests**: `backend/tests/comisiones_config.test.ts`, `comisiones_calculo.test.ts`, `comisiones_fingerprint.test.ts`, `comisiones_liquidacion.test.ts`, `comisiones_routes.test.ts`, `migrations_012.test.ts` (+ smoke en `server.test.ts`, plomería config si aplica), con escenarios de ajustes compensatorios y fingerprint dentro de las suites de cálculo/liquidación/routes.
- **⛔ No** toca: caja/C-11 (solo consulta cobros existentes), obras sociales/C-12 (convive en paralelo según FL-05), recordatorios/C-07, migraciones 001–011 (012 es puramente aditiva al registro).

Por qué ahora: C-12 archivado dejó el patrón liquidación+eventos+commit seguro consolidado; la base pagos (C-11) es estable (89/89 + 674/676 con excepciones documentadas).
