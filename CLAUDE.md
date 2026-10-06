# turnos-odontologia — Instrucciones para Agentes

> Este archivo (y su copia `CLAUDE.md`) es lo PRIMERO que todo agente lee al entrar al repo.
> Generado a partir de `knowledge-base/` y `CHANGES.md`. No editar a mano sin re-sincronizar ambos archivos.

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|------|------------|---------|
| Backend | TypeScript + Node.js + Express (monolito modular) | — |
| Persistencia | SQLite (transacciones `BEGIN IMMEDIATE`, migraciones gestionadas) | — |
| Testing | Vitest (escenarios `Dado/Cuando/Entonces`) | — |
| Auth | JWT + refresh cookie HttpOnly (secure, samesite=lax) | — |
| Moneda | ARS en enteros centavos (`monto_centavos INTEGER`) | — |
| Frontend | **No definido aún** — scaffolding futuro (decisión explícita pendiente) | — |
| Integraciones | WhatsApp API oficial, Mercado Pago (estructuras sin credenciales reales) | — |

Detalle completo: [knowledge-base/08-arquitectura.md](knowledge-base/08-arquitectura.md) y [knowledge-base/09-decisiones.md](knowledge-base/09-decisiones.md)

---

## Base de Conocimiento

La fuente de verdad del dominio vive en `knowledge-base/`. **Leé el archivo relevante ANTES de implementar.**

| Archivo | Cuándo leerlo |
|---------|---------------|
| [01-vision.md](knowledge-base/01-vision.md) | Entender propósito y alcance |
| [02-descripcion.md](knowledge-base/02-descripcion.md) | Alcance MVP, diferenciadores, fuera de alcance |
| [03-actores.md](knowledge-base/03-actores.md) | Auth, RBAC, permisos |
| [04-modelos-datos.md](knowledge-base/04-modelos-datos.md) | Entidades, restricciones, estados, índices |
| [05-reglas-negocio.md](knowledge-base/05-reglas-negocio.md) | Reglas codificadas (RN-XX) |
| [06-features.md](knowledge-base/06-features.md) | Historias de usuario por épica |
| [07-flujos.md](knowledge-base/07-flujos.md) | Flujos E2E |
| [08-arquitectura.md](knowledge-base/08-arquitectura.md) | Patrones, estructura, estrategia de tests |
| [09-decisiones.md](knowledge-base/09-decisiones.md) | Decisiones técnicas y comerciales |
| [10-preguntas-abiertas.md](knowledge-base/10-preguntas-abiertas.md) | ⚠️ Supuestos sin validar antes de tomar decisiones afines |

---

## Skills Disponibles

Fuente de verdad: `.atl/skill-registry.md` (generado por `skill-registry`).

| Agente | Rol | Skills que carga |
|--------|-----|------------------|
| **Backend Core** | Dominios clínicos + caja (agenda, turnos, historia clínica, pagos) | `nodejs-backend-patterns`, `vitest`, `typescript-advanced-types`, `healthcare-phi-compliance` |
| **Backend Aux** | Integraciones, notificaciones, workers | `nodejs-backend-patterns`, `vitest` |
| **Frontend** | UI (cuando se defina el stack) | `typescript-advanced-types` |
| **Orquestación** | OPSX / OpenSpec | `openspec-propose`, `openspec-apply-change`, `openspec-archive-change`, `openspec-explore`, `openspec-sync-specs`, `openspec-update-change` |
| **Fundación / Proceso** | KB, roadmap, skills, discovery | `kb-creator`, `roadmap-generator`, `agents-md-generator`, `discovery-research`, `web-scraper`, `find-skills` |

Cargá la skill correspondiente al contexto ANTES de escribir código.

> Los compact rules de cada skill los resuelve el orquestador desde `.atl/skill-registry.md` (generado por `skill-registry`; no versionado — no está en el repo). Esta tabla solo mapea skill→rol.

---

## Roadmap de Changes

El plan de implementación completo está en [CHANGES.md](CHANGES.md). Resumen:

- **Total**: 20 changes (`C-01`..`C-20`) en 6 fases (Cimientos → Auth/RBAC → Agenda/Turnos MVP Core → Clínica → Obra Social/Comisiones/Reportes → Diferenciadores).
- **Camino crítico** (9 changes, mínimo irreducible): `C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-07 → C-14 → (C-15 según cierre)`.
- **Primer change**: `C-01 foundation-setup` — scaffolding completo (`backend/`, `frontend/`), health check `/api/health`, migraciones iniciales, SQLite, `.env.example`, scripts de dev/CI, runners de test. Governance BAJO, sin dependencias.
- **Primer fork (GATE 3)** tras `C-03`: `C-04` (agenda/anti-solapamiento) ∥ `C-09` (historia clínica) ∥ `C-12` (obras sociales).
- **MVP excluye** diferenciadores `C-16`..`C-20` y todo lo definido fuera de alcance en la KB (ver R13).

**Antes de cualquier `/opsx:propose`**: leé [CHANGES.md](CHANGES.md), identificá las dependencias del change y los archivos de "Leer antes".

---

## Reglas Duras (específicas del proyecto)

> Reglas globales del stack (gobernanza por dominio, TDD estricto, protocolo engram, flujo OPSX): el proyecto las hereda de la configuración global del orquestador. En este archivo viven solo las reglas **específicas de este proyecto** + las universales que el global no cubre (build/commit).

Son contrato; romperlas es un defecto. Formato `NUNCA X → hacer Y`:

1. **R1. Privacidad Clínica** — Nunca almacenar datos reales de pacientes en el repositorio, ni en los ejemplos, ni en los tests. Todos los ejemplos y capturas deben usar datos estrictamente ficticios.
2. **R2. Integridad Financiera ARS** — Todo manejo monetario para la caja, cobros y liquidaciones debe usar tipos numéricos de precisión exacta, prohibiendo terminantemente el uso de variables de coma flotante (float/double).
3. **R3.** NUNCA exponer PHI (nombres, DNI, números de historia clínica) en logs, stack traces, mensajes de error ni query params → logs solo con UUIDs opacos internos.
4. **R4.** Datos clínicos accesibles SOLO vía repositorios + RBAC del C-03; recepción no configura comisiones ni planes de OS; profesional no ve caja global ni comisiones ajenas.
5. **R5.** Todo monto se modela `monto_centavos INTEGER NOT NULL CHECK (monto_centavos >= 0)` + `moneda = 'ARS'`; la conversión a decimales ocurre únicamente en la capa de presentación.
6. **R6.** Porcentajes (ej. `cobertura_pct`) validados como enteros exactos 0..100; nunca como fracciones.
7. **R7.** Stack inamovible: TypeScript + Node.js/Express + SQLite + Vitest → no agregar frameworks, ORMs ni BD sin decisión explícita (KB-08: "no inventar otra cosa").
8. **R8.** Acceso a datos SOLO vía `BaseRepository[T]` + `UnitOfWork` (con `AuditMixin`); NUNCA SQL suelto fuera de la capa de repositorios.
9. **R9.** Concurrencia: toda escritura de turnos que valide solapamiento va en transacción `BEGIN IMMEDIATE` + consulta de intersección `inicio < nuevo_fin AND fin > nuevo_inicio` filtrada por estados activos (`reservado`/`confirmado`/`presente`).
10. **R10.** TypeScript estricto: prohibido `any` sin justificación; identificadores de dominio tipados (brand types: `PatientId ≠ TurnoId ≠ ProfesionalId`).
11. **R11.** Cada regla de negocio con al menos un escenario Vitest `Dado/Cuando/Entonces`; mínimo los 6 escenarios anti-solapamiento de KB-08 §4; `npx vitest run` verde antes de declarar "done".
12. **R12.** Prohibido usar datos reales en fixtures/seed (refuerza R1); en reglas críticas (overlap, caja) NO mockear la capa de transacción — SQLite real en memoria.
13. **R13.** Roadmap = contrato: implementar solo changes de `CHANGES.md`; AFIP/PUCO/ReNaPDiS, portal paciente, app móvil y facturación electrónica quedan FUERA del MVP sin decisión explícita.
14. **R14.** Cada change pasa por `/opsx:propose → /opsx:apply → /opsx:archive`; `openspec/specs` es fuente de verdad; toda afirmación marcada `[Comprobada]`/`[Afirmación]`/`[Supuesto]` con URL + fecha, o "No evidenciado".
15. **R15.** Build/commit: conventional commits; `tsc --noEmit` + `npm test` antes de push; nunca commitear secrets, `.env` con valores reales ni `.atl/`.
16. **R16. Mapa de gobernanza** — NUNCA mergear un change sin su nivel de revisión:
    - **CRITICAL** (requieren revisión explícita antes de merge): agenda/turnos/anti-solapamiento (**C-04**, nodo mandatorio del proyecto), auth/roles/permisos (**C-03**), caja/cobros/multimedio (**C-11**), obras sociales/liquidación (**C-12**), historia clínica/odontograma (**C-09**).
    - **MEDIUM**: reserva online (C-05), confirmación/cancelación/reprogramación (C-06), recordatorios (C-07), bloqueos de agenda (C-08), presupuestos/planes (C-10), comisiones (C-13).
    - **LOW**: reportes read-only (C-14), precios/catálogos (C-15), diferenciadores (C-16..C-20).

---

## Flujo de Trabajo

```
1. Leer la KB relevante (knowledge-base/)        → entender el dominio
2. Identificar el change en CHANGES.md           → respetar dependencias
3. /opsx:propose C-NN-nombre                     → proposal + design + specs + tasks
4. Implementar las tasks (cargando skills)       → respetando las reglas duras
5. /opsx:archive C-NN-nombre + marcar [x]        → cerrar el change
```

Aplicar TODAS las reglas duras en cada paso. Ante conflicto entre la KB y este archivo, las reglas duras prevalecen.
