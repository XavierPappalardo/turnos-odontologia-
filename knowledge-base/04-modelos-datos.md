# 04 — Modelos de datos (alcance mínimo: crear turno sin solapamientos)

**Fecha**: 2026-10-06
**Fuente base**: `discovery/discovery.md` (2026-10-06), secciones 3, 5, 7 y Anexo D.
**Alcance**: entidades mínimas necesarias para el change "crear turno sin solapamientos". Sin datos reales. Todo dato no verificable se marca "No evidenciado".

## 1. Profesional

Representa al odontólogo o profesional que atiende turnos. Base: agenda multi-profesional (discovery.md §5; https://dentalsoft.com.ar/ — 2026-10-06).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `nombre` | TEXT | NOT NULL |
| `matricula` | TEXT | UNIQUE, NULLABLE (No evidenciado formato oficial) |
| `especialidad` | TEXT | NULLABLE |
| `activo` | INTEGER (0/1) | NOT NULL DEFAULT 1 |

## 2. SillonBox

Recurso físico (sillón / box) reservable. Base: agenda "por sillón/box" (discovery.md §5 y Anexo D; https://clinia.com.ar — 2026-10-06 según nota `discovery/sources/clinia.md`).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `nombre` | TEXT | NOT NULL UNIQUE (ej. "Sillón 1" — dato ficticio) |
| `activo` | INTEGER (0/1) | NOT NULL DEFAULT 1 |

## 3. Paciente (ficticio)

Paciente mínimo para reservar un turno. En MVP no hay portal propio (decisión 5). Base: caso de uso 1–2 (discovery.md §3).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `nombre` | TEXT | NOT NULL |
| `telefono_whatsapp` | TEXT | NULLABLE (canal dominante; discovery.md §9; https://dentalsoft.com.ar/ — 2026-10-06) |
| `obra_social_plan_id` | INTEGER | FK → ObraSocialPlan.id, NULLABLE |

Sin datos reales: usar solo fixtures ficticios en tests y seed.

## 4. Prestacion (con duración)

Catálogo de prestaciones con duración variable. Base: "duración variable" (discovery.md §5).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `codigo` | TEXT | NOT NULL UNIQUE (código interno ficticio; nomenclador oficial: No evidenciado) |
| `nombre` | TEXT | NOT NULL |
| `duracion_min` | INTEGER | NOT NULL CHECK (`duracion_min` > 0) |

## 5. Turno (con inicio/fin)

Reserva central del change. Base: regla anti-solapamiento (discovery.md §7).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `profesional_id` | INTEGER | FK → Profesional.id, NOT NULL |
| `sillon_id` | INTEGER | FK → SillonBox.id, NOT NULL |
| `paciente_id` | INTEGER | FK → Paciente.id, NOT NULL |
| `prestacion_id` | INTEGER | FK → Prestacion.id, NULLABLE |
| `inicio` | TEXT (ISO 8601 UTC) | NOT NULL |
| `fin` | TEXT (ISO 8601 UTC) | NOT NULL, CHECK (`fin` > `inicio`) |
| `estado` | TEXT | NOT NULL DEFAULT 'reservado' (ver §8) |
| `origen` | TEXT | NOT NULL DEFAULT 'recepcion' (valores: `recepcion`, `online`, `whatsapp`; supuesto mixto sin validar — ver `10-preguntas-abiertas.md`) |

### Restricciones de solapamiento (nivel aplicación + índice)

1. `fin > inicio` (CHECK SQL).
2. Sin solapamiento por profesional: no pueden existir dos turnos del mismo `profesional_id` en estado activo cuyo intervalo `[inicio, fin)` se intersecte.
3. Sin solapamiento por sillón: igual regla para `sillon_id`.
4. Estados que **ocupan** agenda: `reservado`, `confirmado`, `presente`. Estados que **liberan** agenda: `cancelado`, `ausente`, `atendido`, `bloqueado` (este último solo en entidad Bloqueo).
5. Implementación SQLite: al no haber `EXCLUDE`, la regla se aplica en transacción de escritura (`BEGIN IMMEDIATE`) con consulta de intersección `inicio < nuevo_fin AND fin > nuevo_inicio` filtrada por estados activos, más tests Vitest por escenario dado/cuando/entonces.

## 6. Bloqueo

Franja no reservable (feriado, mantenimiento, ausencia). Base: "bloqueos" (discovery.md §5; https://dentalsoft.com.ar/ — 2026-10-06).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `profesional_id` | INTEGER | FK NULLABLE (NULL = aplica a todos) |
| `sillon_id` | INTEGER | FK NULLABLE (NULL = aplica a todos) |
| `inicio` | TEXT (ISO 8601 UTC) | NOT NULL |
| `fin` | TEXT (ISO 8601 UTC) | NOT NULL, CHECK (`fin` > `inicio`) |
| `motivo` | TEXT | NULLABLE |

Regla: un Turno activo no puede intersectar un Bloqueo aplicable al mismo profesional o sillón.

## 7. ObraSocial / Plan

Cobertura mínima aplicada al turno. En MVP solo se registra cobertura y liquidación básica; sin validación PUCO (fase 2). Base: discovery.md §5 y §7 (https://dentalsoft.com.ar/ — 2026-10-06).

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `obra_social` | TEXT | NOT NULL (nombre ficticio) |
| `plan` | TEXT | NOT NULL |
| `cobertura_pct` | INTEGER | NOT NULL CHECK (0–100) |
| UNIQUE (`obra_social`, `plan`) | — | Evita duplicados |

Verificación contra padrón PUCO: No evidenciado (fase 2 — ver `10-preguntas-abiertas.md`).

## 8. Pago

Cobro mínimo asociado a un turno. Base: caja y cobros multimedio (discovery.md §5; https://dentalsoft.com.ar/ — 2026-10-06). Facturación electrónica AFIP: excluida del MVP.

| Campo | Tipo | Clave / restricción |
|---|---|---|
| `id` | INTEGER | PK autoincremental |
| `turno_id` | INTEGER | FK → Turno.id, NOT NULL |
| `monto_centavos` | INTEGER | NOT NULL CHECK (`monto_centavos` >= 0), moneda ARS (ficticia) |
| `medio` | TEXT | NOT NULL (valores: `efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`) |
| `estado` | TEXT | NOT NULL DEFAULT 'pendiente' (`pendiente`, `cobrado`, `anulado`) |

Integración Mercado Pago: referencia comercial sin credenciales reales en este documento (No evidenciado a nivel implementación).

## 9. Estados de turno (máquina mínima)

`reservado` → `confirmado` → `presente` → `atendido` | `reservado`/`confirmado` → `cancelado` | `confirmado` → `ausente`. Transiciones fuera de este grafo se rechazan. Los estados `cancelado`, `ausente` y `atendido` liberan el hueco para reutilización.

## 10. Diagrama textual

Profesional 1—N Turno N—1 Paciente · SillonBox 1—N Turno · Prestacion 1—N Turno · ObraSocialPlan 1—N Paciente · Turno 1—N Pago · Bloqueo intersecta Turno (regla, no FK).
