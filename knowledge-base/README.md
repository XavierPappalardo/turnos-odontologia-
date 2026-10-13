# turnos-odontologia — Base de Conocimiento

Índice de la base de conocimiento del proyecto. Es la **fuente de verdad del dominio**: si la KB y cualquier otro documento se contradicen, prevalece la KB (salvo que una regla dura de [AGENTS.md](../AGENTS.md) diga lo contrario).

- **Generada a partir de:** [`discovery/discovery.md`](../discovery/discovery.md) (11 puntos + Anexos A–D, 18 sistemas verificados el 2026-10-06) y [`discovery/sources/`](../discovery/sources/) (18 notas, una por competidor).
- **Fecha de la base:** 2026-10-06 (D8 actualizada al archivar `C-01`).
- **Datos:** todos los ejemplos (pacientes, DNI, teléfonos, montos) son **ficticios**. Nunca se almacenan datos reales de pacientes (R1).

---

## Índice de archivos

| Archivo | Contenido |
|---------|-----------|
| [01-vision.md](01-vision.md) | Visión del producto: qué producto, para quién, por qué gana frente a DentalSoft y Dentalink, y qué **no** promete. |
| [02-descripcion.md](02-descripcion.md) | Descripción y alcance: alcance MVP (imprescindible), diferenciadores post-MVP temprano, posteriores/tardíos y **fuera de alcance explícito**. |
| [03-actores.md](03-actores.md) | Actores, roles y permisos: 5 actores (paciente, recepción/administración, odontólogo, dueño/gestor, institución) + matriz de permisos. |
| [04-modelos-datos.md](04-modelos-datos.md) | Modelos de datos: 8 entidades (Profesional, SillonBox, Paciente, Prestacion, Turno, Bloqueo, ObraSocial/Plan, Pago), restricciones de solapamiento, máquina de estados del turno y diagrama textual. |
| [05-reglas-negocio.md](05-reglas-negocio.md) | Reglas de negocio **RN-01 … RN-12** (anti-solapamiento, duración variable, bloqueos, sobreturnos, cobertura OS, comisiones, cierre de caja, costo WhatsApp, precios ARS). |
| [06-features.md](06-features.md) | Features trazables a los casos de uso: **F-01 … F-12** (MVP), **D-01 … D-05** (diferenciadores), **P-01 … P-12** (posteriores/tardíos). |
| [07-flujos.md](07-flujos.md) | Flujos E2E: **FL-01 … FL-05** (reserva online, confirmar/cancelar por WhatsApp, recordatorio automático, cobro con MP + OS, liquidación de comisiones). |
| [08-arquitectura.md](08-arquitectura.md) | Arquitectura: monolito modular, módulos (agenda/turnos, clínica mínima, caja/OS, notificaciones WhatsApp), decisiones arquitectónicas, estrategia de tests Vitest y qué queda fuera del MVP. |
| [09-decisiones.md](09-decisiones.md) | Decisiones aprobadas **D1 … D8**: segmento 1–10 profesionales, AFIP/PUCO/ReNaPDiS en fase 2, WhatsApp API oficial con costo trasladado, stack Node/Express/SQLite/Vitest, portal del paciente en fase 2, supuesto online-vs-WhatsApp sin validar, precios ARS publicados, frontend React + Vite + TypeScript. |
| [10-preguntas-abiertas.md](10-preguntas-abiertas.md) | Preguntas abiertas **P1 … P8**: todo lo `No evidenciado` del Discovery, con su impacto en el roadmap. |

---

## Quick start para desarrolladores

| Si necesitás… | Leé |
|---------------|-----|
| Entender el propósito y el alcance | [01](01-vision.md), [02](02-descripcion.md) |
| Auth, RBAC y permisos | [03](03-actores.md) |
| Entidades, campos, restricciones y estados | [04](04-modelos-datos.md) |
| Reglas de negocio codificadas (RN-XX) | [05](05-reglas-negocio.md) |
| Historias de usuario / features por épica | [06](06-features.md) |
| Flujos E2E | [07](07-flujos.md) |
| Patrones, estructura, estrategia de tests | [08](08-arquitectura.md) |
| Por qué algo está decidido así (y qué se excluyó) | [09](09-decisiones.md) |
| **Antes de decidir o implementar algo dudoso** | [10](10-preguntas-abiertas.md) |

Atajo: `01 → 02 → 04 → 05 → 08` alcanza para entender el núcleo del MVP (crear un turno sin solapamientos).

---

## Cómo se usa la KB en el flujo del proyecto

1. **Antes de `/opsx:propose`** — leé [CHANGES.md](../CHANGES.md) para el change y sus dependencias, y los archivos de "Leer antes" que indica la KB para ese dominio.
2. **Al proponer** — los delta specs citan reglas de la KB (`RN-XX`, `F-XX`, `FL-XX`, `D#`); las restricciones de [04](04-modelos-datos.md) se traducen a esquema y migraciones.
3. **Al implementar** — cada regla de negocio necesita al menos un escenario Vitest `Dado/Cuando/Entonces` (R11); los 6 escenarios anti-solapamiento de [08](08-arquitectura.md) §4 son el mínimo del nodo crítico.
4. **Al archivar** — si una decisión o supuesto cambió, se actualiza la KB (`09`/`10`) además del cambio; `openspec/specs/` sigue siendo la fuente de verdad de los specs.

Rutas relacionadas: [`discovery/README.md`](../discovery/README.md) (índice de la evidencia de mercado) · [`CHANGES.md`](../CHANGES.md) (roadmap y gobernanza por change) · [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md) (reglas duras R1–R16) · [`openspec/`](../openspec/) (specs y changes).

---

## Convención de marcado (obligatoria)

Toda afirmación de mercado se marca y cita con URL + fecha:

| Marca | Significa |
|-------|-----------|
| `[Comprobada]` | Visible en oferta o documentación oficial del competidor. |
| `[Afirmación]` | Declarada por el proveedor sin evidencia verificable. |
| `[Supuesto]` | Hipótesis del proyecto, sin validar. |
| `No evidenciado` | No se encontró evidencia pública. |

Todo `No evidenciado` relevante para el alcance debe además figurar en [10-preguntas-abiertas.md](10-preguntas-abiertas.md).

---

## Resumen ejecutivo

SaaS en la nube de **gestión de turnos y administración para odontología en Argentina**, apuntado a consultorios y clínicas de 1 a 10 profesionales. El MVP cubre el núcleo operativo: agenda multi-profesional y por sillón/box con anti-solapamiento, reserva online 24/7, confirmación y recordatorios por WhatsApp (API oficial), historia clínica con odontograma FDI, presupuestos y planes, caja multimedio con Mercado Pago, obras sociales con liquidación, comisiones por profesional y reportes. Stack inamovible: TypeScript + Node.js/Express + SQLite + Vitest en backend, React + Vite + TypeScript en frontend ([09](09-decisiones.md) D4/D8). Fuera del MVP: AFIP/PUCO/ReNaPDiS, portal del paciente, app móvil, API pública, multi-sucursal y white label ([02](02-descripcion.md), [08](08-arquitectura.md) §6).
