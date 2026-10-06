# Design — c-04-agenda-turnos-overlaps

## Context

Ver `proposal.md` (Why) y `specs/agenda/crear-turno/spec.md` (contrato de comportamiento). Estado actual: parte de cero (`openspec list` sin changes ni specs). Los contratos de scaffolding/migraciones (C-01/C-02) y auth/RBAC JWT (C-03) están ausentes y se toman como [Supuesto]: este diseño define solo lo necesario de C-04 y declara sus dependencias sin implementarlas. Stack inamovible: TypeScript + Express monolito modular + SQLite + Vitest; acceso a datos solo vía `BaseRepository[T]` + `UnitOfWork` (+ `AuditMixin`); brand types; sin floats (no hay montos en este change).

## Goals / Non-Goals

**Goals:**
- Definir entidades, fórmula de solapamiento, flujo transaccional y errores de `POST /api/turnos` de forma implementable en un change CRITICAL.
- Fijar índices y máquina de estados mínima para que la validación sea correcta y auditable.

**Non-Goals:**
- Reserva online (C-05), confirmar/cancelar/reprogramar (C-06), CRUD de bloqueos (C-08), UI/pantallas, integraciones externas. No se diseñan pantallas ni tokens de paciente.

## Decisions

### D1. Entidades (atributos mínimos del change)

- **Turno**: `id` (PK), `profesional_id` FK NOT NULL, `sillon_id` FK NOT NULL, `paciente_id` FK NOT NULL, `prestacion_id` FK NULLABLE, `inicio` TEXT ISO 8601 UTC NOT NULL, `fin` TEXT ISO 8601 UTC NOT NULL + CHECK (`fin > inicio`), `estado` TEXT NOT NULL DEFAULT `'reservado'`, `origen` TEXT NOT NULL DEFAULT `'recepcion'`. Brand types `TurnoId`, `ProfesionalId`, `SillonId`, `PacienteId` (R10).
- **Profesional**: `id`, `nombre` NOT NULL, `matricula` UNIQUE NULLABLE, `especialidad` NULLABLE, `activo` 0/1 DEFAULT 1. En este change solo se valida existencia + activo.
- **SillonBox**: `id`, `nombre` UNIQUE NOT NULL, `activo` 0/1 DEFAULT 1. Solo existencia + activo.
- **Bloqueo** (solo lectura): `id`, `profesional_id` FK NULLABLE (NULL = todos), `sillon_id` FK NULLABLE (NULL = todos), `inicio`/`fin` UTC NOT NULL + CHECK, `motivo` NULLABLE.
- Alternativa descartada: tabla intermedia turno–recurso (N:M). Se descarta porque cada turno ocupa exactamente un profesional y un sillón (KB-04 §5); dos FK directas simplifican la consulta de intersección y los índices.

### D2. Fórmula de validación de solapamiento en tiempo (aplicación, no EXCLUDE)

SQLite no tiene `EXCLUDE`; la regla vive en el servicio de creación (`src/agenda|turnos`), ejecutada dentro de la transacción:

```sql
-- Eje profesional (análogo para sillón con sillon_id = ?):
SELECT 1 FROM turno
 WHERE profesional_id = ?
   AND estado IN ('reservado','confirmado','presente')
   AND inicio < ?  -- nuevo_fin
   AND fin    > ?  -- nuevo_inicio
 LIMIT 1;
-- Bloqueos aplicables:
SELECT 1 FROM bloqueo
 WHERE (profesional_id IS NULL OR profesional_id = ?)
   AND (sillon_id IS NULL OR sillon_id = ?)
   AND inicio < ? AND fin > ?
 LIMIT 1;
```

- Intervalo semiabierto `[inicio, fin)`: la contigüidad (`fin == inicio`) NO es intersección.
- Doble eje AND: se ejecutan ambas consultas; basta un conflicto en cualquiera para `409` (orden de reporte: profesional → sillón → bloqueo).
- La comparación es lexicográfica sobre ISO 8601 UTC de ancho fijo; el servicio normaliza a UTC antes de validar ([Supuesto] convención de zona horaria de C-01/C-02).
- Alternativa descartada: constraint UNIQUE sobre `(profesional_id, inicio)`. Solo impediría inicios idénticos, no solapes parciales/contenidos; insuficiente para RN-01/RN-02.

### D3. Flujo transaccional `BEGIN IMMEDIATE`

1. Abrir transacción `BEGIN IMMEDIATE` vía `UnitOfWork` (bloquea escritores concurrentes en SQLite).
2. Validar entrada (`fin > inicio`, FKs, formato UTC) → `400` + ROLLBACK.
3. Autorización RBAC ([Supuesto] middleware C-03) → `403` + ROLLBACK. Sin PHI en logs (R3: solo UUIDs opacos).
4. Consulta intersección eje profesional → conflicto ⇒ `409 {eje:"profesional"}` + ROLLBACK.
5. Consulta intersección eje sillón → conflicto ⇒ `409 {eje:"sillon"}` + ROLLBACK.
6. Consulta bloqueos aplicables → conflicto ⇒ `409 {eje:"bloqueo"}` + ROLLBACK.
7. `INSERT` turno `reservado` vía `BaseRepository<Turno>` (+ `AuditMixin`) → COMMIT → `201`.
8. Todo acceso SQL encapsulado en repositorios (R8); el endpoint nunca emite SQL suelto.

### D4. Máquina de estados mínima

`reservado → confirmado → presente → atendido`; `reservado|confirmado → cancelado`; `confirmado → ausente`. Ocupan agenda: `reservado`, `confirmado`, `presente`. Liberan: `cancelado`, `ausente`, `atendido`. Este change solo crea en `reservado` y declara el grafo; las transiciones se implementan en C-06.

### D5. Errores

| Código | Cuándo | Cuerpo (sin PHI) |
|---|---|---|
| `400` | `fin<=inicio`, campo faltante, FK inexistente, fecha no UTC | `{error:"validacion", detalle, ids opacos}` |
| `403` | rol sin permiso ([Supuesto] RBAC C-03) | `{error:"forbidden"}` sin PHI |
| `409` | solape profesional / sillón / bloqueo | `{error:"conflicto", eje:"profesional"\|"sillon"\|"bloqueo", turno_id?}` solo ids opacos |
| `201` | creado | turno `reservado` |

### D6. Índices (migración 003, [Supuesto] base C-01/C-02)

- `CREATE INDEX idx_turno_prof_intervalo ON turno(profesional_id, inicio, fin);`
- `CREATE INDEX idx_turno_sillon_intervalo ON turno(sillon_id, inicio, fin);`
- `CREATE INDEX idx_bloqueo_aplicabilidad ON bloqueo(profesional_id, sillon_id, inicio, fin);`
- `CHECK (fin > inicio)` en `turno` y `bloqueo`. Sin `EXCLUDE` (no soportado); la unicidad lógica la garantiza D2+D3.

## Risks / Trade-offs

- [Riesgo] C-01/C-02/C-03 ausentes → contratos de migración, seed de FKs y RBAC son [Supuesto] → Mitigación: tasks.md incluye test de humo de supuestos y los specs marcan [Supuesto] explícito; GATE CRITICAL (R16) exige revisión antes de merge.
- [Riesgo] Race condition si alguna escritura futura omite `BEGIN IMMEDIATE` → Mitigación: toda escritura de turnos pasa por `UnitOfWork` transaccional (R9) + test de concurrencia con SQLite real en memoria (R12, sin mock de transacción).
- [Trade-off] Comparación lexicográfica de fechas exige UTC normalizado → Mitigación: el servicio normaliza a ISO 8601 UTC y rechaza (`400`) formatos ambiguos.
- [Riesgo] PHI en logs/errores (R3) → Mitigación: logs solo con UUIDs opacos; revisión de errores 400/403/409 sin nombres/DNI/teléfonos.

## Open Questions

- Ninguna que bloquee el plan: numeración exacta de la migración 003 y nombres de módulos `src/` se confirman contra C-01/C-02 durante APPLY sin cambiar specs ni enfoque.
