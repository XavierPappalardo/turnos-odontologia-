# Proposal

## Why

La clínica atiende pacientes con cobertura de obras sociales argentinas y hoy el MVP solo guarda el catálogo mínimo `obra_social_plan` (C-02, migración 004) y un repositorio de consulta por plan: no hay cálculo verificable de cobertura ni saldo del paciente por tratamiento y plan al momento del turno (RN-07 [Comprobada a nivel de oferta]; fuentes: https://dentalsoft.com.ar/ y https://dental.delriotech.com.ar/ — 2026-10-06, discovery §5/§7), y mucho menos una estructura trazable de reintegros por obra social (FL-05, CU-7). **Objetivo**: implementar cobertura por plan y liquidación básica de reintegros (F-08) sin depender de C-10 ni C-11. **Beneficios**: el importe que paga la obra social y el saldo que paga el paciente quedan calculados (con aritmética exacta `BigInt`), persistidos y auditables; las liquidaciones llevan historial completo de quién generó/presentó/pagó y cuándo; los reintegros se pueden excluir de liquidaciones duplicadas; y C-13 (comisiones) queda desbloqueado (GATE 8 de CHANGES.md).

Nota de gobernanza: `CHANGES.md` clasifica C-12 como ALTO, pero `AGENTS.md` R16 lo exige **CRITICAL** (obras sociales/liquidación); prevalece R16 y el change se implementa con revisión explícita pre-merge.

## What Changes

- **Reutilización del modelo `ObraSocialPlan`** ya definido en C-02 (migración 004: `cobertura_pct` CHECK 0..100, `UNIQUE (obra_social, plan)`): C-12 verifica su implementación real, desarrolla su CRUD con RBAC y NO redefine su esquema.
- **Migración `011`** (nueva, agregada al registro `MIGRATIONS` después de la **010 de C-11, archivado el 04/11/2026**; nunca se creó una 010 ficticia ni se alteran migraciones anteriores; **independiente de la 010** — el runner aplica la pendiente que corresponda sin reordenar ni re-ejecutar nada):
  - `obra_social_cobertura_turno`: registro del cargo por turno/prestación con `monto_total_centavos` (declarado), `cobertura_pct` (snapshot del plan), `cobertura_centavos` y `saldo_paciente_centavos` (RN-07, cálculo en servicio, invariante garantizado por CHECKs).
  - `obra_social_liquidacion`: cabecera de liquidación de reintegros por plan y período con `monto_total_centavos`, `generada_por_usuario_id` y estados: `borrador → presentada → pagada` (Decisión Q2 aprobada).
  - `obra_social_liquidacion_item`: ítems por turno con la cobertura liquidada, snapshot de importes y unicidad lógica que impide que un mismo turno se liquide dos veces (prevención de duplicaciones/inconsistencias), filtrando exclusivamente turnos en estado `atendido` (Decisión Q4 aprobada) dentro del período definido por `turno.inicio` (Decisión Q3 aprobada).
  - `obra_social_liquidacion_evento`: **historial append-only** de la liquidación (evento `generada`/`presentada`/`pagada` + `actor_usuario_id` + `ocurrido_en` del momento de negocio + `created_at` como sello de inserción, alineado al contrato de `AppendOnlyRepository`), inmutable vía triggers `no_update`/`no_delete` al estilo C-09, que responde quién generó, presentó y marcó como pagada cada liquidación y cuándo ocurrió cada transición.
- **Lógica de cobertura por plan (RN-07)**: servicio puro de cálculo `cobertura = f(monto, cobertura_pct)` con multiplicación y división en `BigInt` (truncamiento equivalente a `floor` para no negativos; resultado rechazado con `400` si no es convertible a `number` seguro) + `saldo = monto − cobertura`, aplicado con el **porcentaje general del plan** al importe declarado de la prestación del turno — **sin** porcentajes diferenciales por tratamiento ni nomenclador [No evidenciado] — y persistencia del registro por turno vía repositorios (`BaseRepository[T]` + `UnitOfWork` + `AuditMixin`, R8). El punto de registro materializa FL-04 paso 1 (KB: "el turno confirmado genera el cargo 'total prestación menos cobertura'") como una **operación explícita de cobertura con importe declarado** (`POST /api/obras-sociales/coberturas`, roles recepción/administración): **no** hay generación automática al confirmar turnos y **no** se alteran los flujos de reserva/confirmación/cancelación (C-04, C-05 y C-06 intocados).
- **CRUD y consulta de planes con RBAC (R4)**: configurar/ocultar planes = solo `administracion`; lectura = `recepcion`, `profesional`, `administracion`. Recepción NO configura planes de obra social.
- **Estructura de liquidación de reintegros**: generación de borrador por plan/período desde coberturas registradas (filtrando por fecha de atención `turno.inicio` según Decisión Q3 y requiriendo exclusivamente turnos en estado `atendido` según Decisión Q4), consulta y transición de estados (`borrador → presentada → pagada` según Decisión Q2) con **evento de historial en cada transición y en la generación** (quién/cuándo), con trazabilidad (actor generador, snapshot de montos, totales agregados) en acceso restringido a `administracion`.
- **Brand types** `CoberturaTurnoId`, `LiquidacionOsId`, `LiquidacionOsItemId` y tipos de dominio en `shared/types.ts` (R10); TypeScript estricto, sin `any` (R10); toda prueba sobre SQLite real en memoria (R12).
- **Tests Vitest Dado/Cuando/Entonces (R11)** para: cálculo de cobertura con BigInt (incluido truncamiento/floor y rechazo `400` de resultados no convertibles a `number` seguro), saldo del paciente, invariancia `cobertura + saldo = total`, unicidad anti-duplicación de liquidación y de reintegro por turno, historial de eventos de liquidación (generación, transición e inmutabilidad), permisos RBAC y estados de liquidación.

### Alcance y restricciones explícitas

- Dependencia única: **C-03** (`auth-roles-permisos`, archivado) para RBAC/JWT. **No depende de C-10 ni C-11**: ninguna FK o import apunta a `presupuesto`, `item_presupuesto`, ni a tablas/extensiones de caja de la migración 010 de C-11 (existente desde su archivado el 04/11/2026 y sin referenciación en C-12). **C-11 y C-12 son independientes entre sí**: cada change lleva su propia migración y puede implementarse en cualquier orden sin dependencias de datos [corr. 2ª ronda].
- Montos exclusivamente `*_centavos INTEGER ≥ 0` + `moneda = 'ARS'` (R2/R5); nunca `float`/`double`; la multiplicación del cálculo RN-07 se hace en `BigInt` y solo se convierte a `number` si el resultado no excede `Number.MAX_SAFE_INTEGER` (comparación en dominio `BigInt` **antes** de convertir, design D3; rechazo `400` en caso contrario). Porcentajes enteros 0..100 (R6).
- Los `cobertura_pct` son generales del plan (KB-04 §7): sin porcentajes diferenciales por prestación ni nomenclador en C-12.
- Tipos de FKs alineados a las migraciones reales 001–004 [comprobado]: todas las tablas referenciadas usan `id TEXT` (uuid), incluida `usuario(id)`; la KB-04 los conceptúa como INTEGER — diferencia documentada en design D2 para re-sincronización futura de la KB.
- El SQL permanece dentro de repositorios (R8); ningún SQL suelto en servicios/rutas.

### Exclusiones (fuera de alcance)

- **PUCO / padrones / integraciones externas**: fase 2 (P3 de `10-preguntas-abiertas.md`); sin PUCO el MVP solo registra cobertura declarada por plan.
- **AFIP / facturación electrónica / monotributo**: excluidos (P2, decisión aprobada fase 2).
- **Nomenclador oficial / cobertura diferencial por prestación**: `No evidenciado` (la KB solo evidencia `cobertura_pct` por plan, KB-04 §7); queda como decisión pendiente, no se implementa pct por prestación.
- **Cobros reales a obras sociales, caja multimedio, cierre diario, deudas de C-11**: el registro de cobertura es estructura, no cobro; el medio `obra_social` de la tabla `pago` (C-02) permanece sin uso en C-12.
- **Integración del estimador en la reserva online pública** (FL-01 paso 2): la estimación queda interna y autenticada; su exposición pública se difería (sin evidencia de necesidad del owner).
- **Reglas de reintegro por obra social (plazos, observaciones, topes, pre-facturación, modalidades)**: `No evidenciado`; solo estructura mínima + decisión pendiente.
- **Frontend/UI**: no se toca.
- **Precios/catálogos (C-15)**: C-12 no crea catálogo; el `monto_total_centavos` se declara al registrar la cobertura (fuente futura de precio decidida con C-15).

## Capabilities

### New Capabilities

- `obras-sociales/planes`: configuración (CRUD `administracion`) y consulta de planes de obra social y su `cobertura_pct`, sobre el modelo existente `obra_social_plan`, con RBAC R4 (recepción no configura) y unicidad `(obra_social, plan)` ya garantizada por la migración 004.
- `obras-sociales/cobertura`: cálculo (RN-07), registro por turno/prestación y consulta del cargo OS con el **porcentaje general del plan** sobre el importe declarado (sin nomenclador ni pct diferencial): `cobertura_centavos` del plan y `saldo_paciente_centavos`, con snapshot del porcentaje, invariantes financieros-enteros, RBAC (recepción/administracion gestionan; profesional lee el propio) y trazabilidad auditable.
- `obras-sociales/liquidacion`: estructura de liquidación de reintegros por obra social (cabecera por plan/período + ítems por turno), generación en borrador a partir de coberturas no liquidadas filtradas por `turno.inicio` (Q3) y con turnos en estado `atendido` (Q4), transiciones de estado `borrador → presentada → pagada` (Q2) con **historial auditable append-only de la generación y cada transición (quién/cuándo)**, bloqueo de edición de ítems una vez presentada, y prevención de duplicaciones (un turno en una sola liquidación vigente por plan).

### Modified Capabilities

- Ninguna. C-12 no cambia requisitos de capacidades existentes (`core/models` sigue SHALL persistir `obra_social_plan`; `auth/auth-roles` no enumera permisos por recurso; `agenda/*` y `clinica/*` quedan intactos).

## Impact

- **Backend** (`backend/src`):
  - `shared/migrations.ts`: nueva `MIGRATION_011_OBRAS_SOCIALES` (**cuatro tablas**, CHECKs, índices parciales UNIQUE `WHERE deleted_at IS NULL`, triggers insert-only de la tabla de eventos y FKs solo a `obra_social_plan`/`turno`/`prestacion`/`usuario`, todas con ids `TEXT` según 001–004) + registro en `MIGRATIONS` después de la `010` de C-11; el runner aplica la pendiente en orden del array **sin reordenar ni re-ejecutar migraciones** (001–010 intactas, sin dependencia mutua).
  - Repositorio `core/obraSocialPlan.repository.ts`: **existente desde C-02 — se reutiliza y extiende en su archivo** (CRUD de planes); NO se crea un repositorio duplicado de planes.
  - Nuevo módulo `src/obras-sociales/`: `cobertura.repository.ts`, `liquidacion.repository.ts`, `liquidacionItem.repository.ts`, `liquidacionEvento.repository.ts` (append-only), `planes.service.ts`, `coberturas.service.ts`, `liquidaciones.service.ts` (cálculo RN-07 con `BigInt`, elegibilidad y máquina de estados con eventos), `planes.routes.ts`, `coberturas.routes.ts`, `liquidaciones.routes.ts`.
  - `shared/auth.ts`: matrices `ROLES_OS_PLAN_GESTION` (solo `administracion`), `ROLES_OS_PLAN_LECTURA` (todos los roles), `ROLES_OS_COBERTURA_GESTION` (`recepcion`, `administracion`), `ROLES_OS_LIQUIDACION` (solo `administracion`).
  - `shared/types.ts`: brand types y tipos de dominio OS (estados, transiciones liquidación).
  - `shared/app.ts`: montaje del router OS bajo `/api`.
- **Tests** (`backend/tests/*.test.ts`): `obras_sociales_planes.test.ts`, `obra_social_cobertura.test.ts`, `obra_social_liquidacion.test.ts` (incluye escenarios de historial de eventos y `400` por conversión no segura), `migrations_011.test.ts` (Vitest + SQLite en memoria, sin mockear transacciones, R12).
- **Datos**: seed ficticio sin cambios estructurales; ejemplos y fixtures estrictamente ficticios (R1/R12).
- **Frontend**: sin cambios.
- **Cambios anteriores respetados**: ningún archivo de migración 001–010 se modifica; el change `caja-cobros-multimedio-mercadopago` (archivado el 04/11/2026 en `openspec/changes/archive/2026-11-04-caja-cobros-multimedio-mercadopago/`) NO se toca ni se asume.
