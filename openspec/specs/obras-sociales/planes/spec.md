# obras-sociales/planes Specification

## Purpose
Gestión y consulta de planes de obra social con su **porcentaje general** de cobertura entera 0–100 sobre el modelo existente `obra_social_plan` (un único `cobertura_pct` por plan, sin nomenclador ni variantes por prestación — KB-04 §7), con RBAC estricto: solo `administracion` configura planes y recepción/profesional/administración los consultan (R4; F-08; KB-04 §7). El repositorio de planes es el existente de `src/core/obraSocialPlan.repository.ts`, reutilizado y extendido (sin duplicación).

## Requirements

### Requirement: Consulta de planes autenticada

El sistema SHALL exponer `GET /api/obras-sociales/planes` para cualquier rol autenticado (`recepcion`, `profesional`, `administracion`), listando los planes vigentes (`deleted_at` nulo) con `id`, `obra_social`, `plan`, `cobertura_pct`, `activo`. El endpoint SHALL aceptar filtros opcionales exactos `obra_social` y `plan`. SHALL responder `401` sin token vigente. La respuesta no SHALL incluir PHI.

#### Scenario: Listado completo para recepción

- **WHEN** un usuario con rol `recepcion` llama `GET /api/obras-sociales/planes`
- **THEN** el sistema responde `200` con los planes vigentes y sus `cobertura_pct`, sin PHI de pacientes

#### Scenario: Listado con filtros exactos

- **WHEN** se llama `GET /api/obras-sociales/planes?obra_social=Obra%20Social%20Ficticia&plan=Plan%20Ficticio%20100` sobre el seed ficticio
- **THEN** el sistema responde `200` con exactamente los planes que coinciden con esa combinación

#### Scenario: Sin token rechazado

- **WHEN** se llama `GET /api/obras-sociales/planes` sin `Authorization`
- **THEN** el sistema responde `401` y no devuelve datos

### Requirement: Creación de plan solo para administración

El sistema SHALL exponer `POST /api/obras-sociales/planes` accesible únicamente con rol `administracion` y SHALL rechazar con `403` sin ejecutar acciones a `recepcion` ni `profesional` (R4). El body SHALL validar `obra_social` y `plan` no vacíos, y `cobertura_pct` entero exacto 0..100 (R6: sin fracciones ni decimales). Ante `UNIQUE (obra_social, plan)` violada SHALL responder `409` sin persistir.

#### Scenario: Plan ficticio creado por administración

- **WHEN** `administracion` envía `{obra_social: "Obra Social Ficticia B", plan: "Plan Ficticio 300", cobertura_pct: 30}`
- **THEN** el sistema responde `201`, persiste el plan con `activo = 1` y el valor exacto de cobertura

#### Scenario: Porcentaje fuera de rango rechazado

- **WHEN** `administracion` envía `cobertura_pct: 101` (o `-1`)
- **THEN** el sistema responde `400` y no persiste el plan

#### Scenario: Porcentaje no entero rechazado

- **WHEN** `administracion` envía `cobertura_pct: 25.5`
- **THEN** el sistema responde `400` y no persiste el plan (R6: porcentajes enteros exactos)

#### Scenario: Recepción no configura planes

- **WHEN** un usuario con rol `recepcion` llama `POST /api/obras-sociales/planes` con un body válido
- **THEN** el sistema responde `403` y no persiste ningún plan

#### Scenario: Profesional no configura planes

- **WHEN** un usuario con rol `profesional` llama `POST /api/obras-sociales/planes` con un body válido
- **THEN** el sistema responde `403` y no persiste ningún plan

#### Scenario: Combinación obra social + plan duplicada rechazada

- **WHEN** `administracion` crea un plan con la misma combinación `(obra_social, plan)` que un plan previo ya existente
- **THEN** el sistema responde `409` y no persiste el plan

### Requirement: Edición de plan solo para administración

El sistema SHALL exponer `PATCH /api/obras-sociales/planes/:id` únicamente con rol `administracion`; campos permitidos: `obra_social`, `plan`, `cobertura_pct` (validaciones R6) y `activo` (0/1). SHALL responder `404` ante plan inexistente o de baja lógica y `400` ante campos fuera de allowlist o valores inválidos. Cambiar `cobertura_pct` no SHALL recalcular coberturas ya emitidas.

#### Scenario: Cobertura actualizada por administración

- **WHEN** `administracion` aplica `PATCH` con `cobertura_pct: 70` sobre un plan vigente
- **THEN** el sistema responde `200` con `cobertura_pct: 70` y `updated_at` refrescado; las coberturas ya registradas mantienen su pct snapshot previo

#### Scenario: Campo fuera de allowlist rechazado

- **WHEN** `administracion` envía `PATCH` con `cobertura_pct: 70` junto a `monto_centavos`
- **THEN** el sistema responde `400` y no modifica ningún campo

#### Scenario: Plan inexistente o eliminado

- **WHEN** `administracion` aplica `PATCH` sobre un plan inexistente o ya de baja lógica
- **THEN** el sistema responde `404` y no revive el plan

#### Scenario: Recepción no edita planes

- **WHEN** un usuario con rol `recepcion` llama `PATCH /api/obras-sociales/planes/:id` con un body válido
- **THEN** el sistema responde `403` y no se modifica el plan

### Requirement: Baja lógica de plan solo para administración

El sistema SHALL exponer `DELETE /api/obras-sociales/planes/:id` únicamente con rol `administracion`, con baja lógica (sello `deleted_at`, sin borrar filas) y `activo = 0`. Tras la baja, el plan SHALL desaparecer del listado; la combinación `(obra_social, plan)` no SHALL poder re-crearse (409 por UNIQUE de la migración 004). La baja lógica de planes conserva las asignaciones históricas de pacientes sin reasignación forzada (Decisión Q5 aprobada).

#### Scenario: Plan ficticio dado de baja

- **WHEN** `administracion` llama `DELETE /api/obras-sociales/planes/:id` sobre un plan vigente
- **THEN** el sistema responde `200`, el plan queda con `deleted_at` sellado y ya no aparece en `GET /api/obras-sociales/planes`

#### Scenario: Segunda baja idempotente

- **WHEN** `administracion` llama `DELETE` del mismo plan ya de baja lógica
- **THEN** el sistema responde `404` y no re-sella `deleted_at`

#### Scenario: Profesional no elimina planes

- **WHEN** un usuario con rol `profesional` llama `DELETE /api/obras-sociales/planes/:id`
- **THEN** el sistema responde `403` y el plan sigue vigente
