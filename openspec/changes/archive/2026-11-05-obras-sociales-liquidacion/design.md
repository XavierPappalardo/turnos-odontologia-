# Design

## Context

- **Estado del repo al preparar este change**: rama `main` sincronizada con `origin/main` (último commit `b867772 "Subo c-10"`), sin cambios pendientes en el árbol salvo la carpeta NO versionada `openspec/changes/caja-cobros-multimedio-mercadopago/` (propuesta OPSX de C-11 aún no implementada: no se asume ni se toca). **Actualizado 05/11/2026 [comprobado con `git status`/`openspec list`]**: C-11 se archivó el 04/11/2026 en `openspec/changes/archive/2026-11-04-caja-cobros-multimedio-mercadopago/` y su migración 010 existe; el árbol mantiene trabajo local no commiteado de la implementación parcial de este change, que se preserva.
- **Dependencia C-12 → C-03 [comprobada]**: `auth-roles-permisos` está completo y archivado en `openspec/changes/archive/2026-10-28-c-03-auth-roles-permisos/` con JWT, cookies de refresh y matriz RBAC en `src/shared/auth.ts`. C-12 **no depende** de C-10 `presupuestos-planes-tratamiento` (commiteado recientemente y señalado por el owner como "subido incorrectamente" — no debe usarse como base) ni de C-11 (archivado el 04/11/2026: existe la 010; C-12 sigue sin FK, sin imports y sin dependencia de datos igualmente — D1).
- **Estado real de migraciones [comprobado en `src/shared/migrations.ts`; actualizado 05/11/2026]**: registro `MIGRATIONS` con ids `001..011` (004 creó `obra_social_plan` con `cobertura_pct` CHECK 0..100 y `UNIQUE (obra_social, plan)`; 003/008 completaron `turno` y `paciente`; la **010 es de C-11 de caja, archivado el 04/11/2026**; la **011 es la de este change**, registrada después de la 010). **Nunca se creó una 010 ficticia ni se alteran 001–010**.
- **Implementación real de `ObraSocialPlan` [comprobada]**: tabla en 004, fila de seed (`os-seed-0001`, cobertura 100), `ObraSocialPlanRepository.buscarPorPlan` y el tipo `ObraSocialPlanRow`. No hay service, rutas, RBAC ni tests propios: ese vacío es parte de este change.
- **Evidencia de dominio**: RN-07 [Comprobada a nivel de oferta] — la cobertura se calcula por tratamiento y plan al momento del turno y la diferencia queda como saldo a cobrar; en este change se materializa como el porcentaje general del plan (`cobertura_pct`) sobre el importe declarado de la prestación del turno, sin porcentajes diferenciales ni nomenclador (D4; Open Question 7); FL-04/CU-6 pasos 1–2 y FL-05/CU-7 paso 3; KB-04 §7 (plan con `cobertura_pct`, sin nomenclador); P3 — PUCO fase 2: sin PUCO, el MVP solo registra cobertura declarada por plan.

## Goals / Non-Goals

**Goals:**

- Migración `011` idempotente (patrón del runner vigente: `schema_migrations` + `BEGIN IMMEDIATE` + SQL `IF NOT EXISTS`) con **cuatro tablas OS** (cobertura por turno, liquidación, ítems y eventos de estado) y su integridad (CHECKs + índices únicos parciales + triggers insert-only al estilo C-09 para el historial).
- Cálculo RN-07 en la capa de servicio con aritmética estricta de centavos enteros y `CHECK`s en SQLite como barrera defensiva adicional.
- Persistencia y consulta del cargo OS por turno (`obra_social_cobertura_turno`) con snapshot del `cobertura_pct` del plan.
- Estructura de liquidación de reintegros (cabecera + ítems con snapshot) con generación en borrador vía `UnitOfWork` transaccional, prevención de reintegros duplicados e historial auditable de quién/cuándo en cada transición (`obra_social_liquidacion_evento` append-only).
- RBAC en `src/shared/auth.ts` siguiendo el patrón de matrices vigente: R4 aplicado (recepción no configura planes OS ni opera liquidaciones).
- Brand types de dominio OS y reglas expresables en tests Vitest `Dado/Cuando/Entonces` (SQLite real en memoria, sin mockear transacciones).

**Non-Goals:**

- PUCO/AFIP/ReNaPDiS/facturación electrónica (R13; P2/P3 fase 2).
- Nomenclador oficial y cobertura diferencial por prestación: **No evidenciado** (KB-04 §7 solo evidencia `cobertura_pct` por plan).
- Cobros reales, caja, cierre diario, deudas y Mercado Pago (C-11); la tabla `pago` (C-02) no se toca ni se enlaza por FK en C-12.
- Catálogo de precios/prestaciones (C-15): el `monto_total_centavos` se declara al registrar el cargo; no se crea catálogo ni se inventan precios.
- Estimación OS en la reserva online pública (FL-01 paso 2) y frontend/UI.
- Reglas comerciales de reintegro (plazos, observaciones, modalidades): **No evidenciado**; solo estructura mínima y decisión pendiente.

## Decisions

### D1. Migración `011` al final del registro; sin 010 ficticia ni renumeraciones

**Razón:** el runner vigente (`runMigrations` en `src/shared/migrations.ts`) crea la tabla de control `schema_migrations`, recorre el array `MIGRATIONS` en orden y aplica **solo las migraciones pendientes** (ids aún no registrados) dentro de `BEGIN IMMEDIATE`; los ids ya ejecutados se ignoran: **nunca se reordenan ni se re-ejecutan**. Al preparar el change el estado real llegaba hasta `009` (la 010 estaba reservada a C-11 y aún no existía); tras el archivado de C-11 la `010` existe y la `011` quedó registrada como entrada `MIGRATION_011_OBRAS_SOCIALES` después de la `010`, sin alterar 001–010 y sin depender de ella. **C-11 y C-12 deben ser independientes entre sí**: cada change aporta su propia migración, sin dependencias de datos ni de tablas ajenas (la 011 crea tablas propias con FKs únicamente a core 001–004 y no referencia `presupuesto`, `pago` ni tablas de caja de la futura 010). Como la 011 no depende de la 010, el orden temporal en que cada change se implemente es irrelevante para el runner: no se requiere reordenar el array ni tocar migraciones ya ejecutadas.
**Alternativa considerada:** renumerar C-12 como 010. Rechazada: contradice CHANGES.md y la instrucción explícita del owner ("no crees una migración 010 ficticia").

### D2. Cuatro tablas OS con FKs solo a core (sin acoplarse a C-10 ni C-11)

`obra_social_cobertura_turno` (registro por turno), `obra_social_liquidacion` (cabecera por plan/período), `obra_social_liquidacion_item` (ítems por turno) y `obra_social_liquidacion_evento` (historial append-only de la liquidación; decisión documentada al final de esta decisión). **Tipos de FKs [comprobado en migraciones 001–009]**: las claves primarias de las tablas referenciadas son todas `id TEXT PRIMARY KEY` — `turno(id)` (003), `prestacion(id)` (001), `obra_social_plan(id)` (004) y `usuario(id)` (002) — por lo que aquí todas las columnas `*_id` son `TEXT NOT NULL REFERENCES <tabla>(id)`. **Diferencia con la KB**: KB-04 §7 modela los ids conceptualmente como `INTEGER`; la implementación real del repo (001–009) adoptó ids `TEXT` (uuid), y este design sigue la implementación vigente — el detalle queda señalado para la próxima re-sincronización de la KB. FKs únicamente a `obra_social_plan(id)`, `turno(id)`, `prestacion(id)` y `usuario(id)` (todas de 001–004); `obra_social_liquidacion_item` referencia además a `obra_social_cobertura_turno(id)`. **Sin FK a `presupuesto`/`item_presupuesto`** (C-10 descartado como base) **ni a `pago`** (C-11 archivado: sin acoplamiento en C-12); la coordinación liquidaciones–caja queda explícitamente fuera de este change (Open Question 6). **Unicidad por turno** [Comprobada en 003]: en el modelo vigente `turno.prestacion_id` es una columna única nullable (no existe tabla de detalle multi-prestación por turno), por lo que hoy hay a lo sumo una prestación por turno y una única cobertura se registra por `turno_id` (índice único `os_cobertura_turno_unica`); una eventual cobertura multi-prestación por turno requeriría el ajuste de la FK `turno.prestacion_id` fuera de este change y no se anticipa aquí (R13).

```sql
CREATE TABLE IF NOT EXISTS obra_social_cobertura_turno (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  prestacion_id TEXT NOT NULL REFERENCES prestacion(id),
  obra_social_plan_id TEXT NOT NULL REFERENCES obra_social_plan(id),
  monto_total_centavos INTEGER NOT NULL
    CHECK (monto_total_centavos >= 0)
    CHECK (monto_total_centavos = CAST(monto_total_centavos AS INTEGER)),
  cobertura_pct INTEGER NOT NULL
    CHECK (cobertura_pct BETWEEN 0 AND 100)
    CHECK (cobertura_pct = CAST(cobertura_pct AS INTEGER)),
  cobertura_centavos INTEGER NOT NULL
    CHECK (cobertura_centavos >= 0)
    CHECK (cobertura_centavos = CAST(cobertura_centavos AS INTEGER)),
  saldo_paciente_centavos INTEGER NOT NULL
    CHECK (saldo_paciente_centavos >= 0)
    CHECK (saldo_paciente_centavos = CAST(saldo_paciente_centavos AS INTEGER)),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (cobertura_centavos <= monto_total_centavos),
  CHECK (saldo_paciente_centavos = monto_total_centavos - cobertura_centavos)
);
CREATE UNIQUE INDEX IF NOT EXISTS os_cobertura_turno_unica
  ON obra_social_cobertura_turno(turno_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_cobertura_plan_fecha
  ON obra_social_cobertura_turno(obra_social_plan_id, created_at);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion (
  id TEXT PRIMARY KEY,
  obra_social_plan_id TEXT NOT NULL REFERENCES obra_social_plan(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL CHECK (hasta >= desde),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'presentada', 'pagada')), -- Decisión Q2 aprobada
  monto_total_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (monto_total_centavos >= 0)
    CHECK (monto_total_centavos = CAST(monto_total_centavos AS INTEGER)),
  generada_por_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS os_liquidacion_plan_periodo_unica
  ON obra_social_liquidacion(obra_social_plan_id, desde, hasta) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_liquidacion_estado ON obra_social_liquidacion(estado);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion_item (
  id TEXT PRIMARY KEY,
  liquidacion_id TEXT NOT NULL REFERENCES obra_social_liquidacion(id),
  cobertura_id TEXT NOT NULL REFERENCES obra_social_cobertura_turno(id),
  turno_id TEXT NOT NULL REFERENCES turno(id),
  monto_cobertura_centavos INTEGER NOT NULL
    CHECK (monto_cobertura_centavos >= 0)
    CHECK (monto_cobertura_centavos = CAST(monto_cobertura_centavos AS INTEGER)),
  saldo_paciente_centavos INTEGER NOT NULL
    CHECK (saldo_paciente_centavos >= 0),
  cobertura_pct INTEGER NOT NULL
    CHECK (cobertura_pct BETWEEN 0 AND 100)
    CHECK (cobertura_pct = CAST(cobertura_pct AS INTEGER)),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS os_item_turno_liquidado_unico
  ON obra_social_liquidacion_item(turno_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS os_item_liquidacion
  ON obra_social_liquidacion_item(liquidacion_id);

CREATE TABLE IF NOT EXISTS obra_social_liquidacion_evento (
  id TEXT PRIMARY KEY,
  liquidacion_id TEXT NOT NULL REFERENCES obra_social_liquidacion(id),
  evento TEXT NOT NULL CHECK (evento IN ('generada', 'presentada', 'pagada')),
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  ocurrido_en TEXT NOT NULL, -- momento del evento de negocio
  created_at TEXT NOT NULL  -- sello de inserción (contrato de AppendOnlyRepository)
);
CREATE INDEX IF NOT EXISTS os_evento_liquidacion
  ON obra_social_liquidacion_evento(liquidacion_id, ocurrido_en);
CREATE TRIGGER os_evento_no_update BEFORE UPDATE ON obra_social_liquidacion_evento
BEGIN SELECT RAISE(ABORT, 'obra_social_liquidacion_evento es insert-only'); END;
CREATE TRIGGER os_evento_no_delete BEFORE DELETE ON obra_social_liquidacion_evento
BEGIN SELECT RAISE(ABORT, 'obra_social_liquidacion_evento es insert-only'); END;
```

**Razón:** separar cabecera/ítems permite períodos con varios turnos y snapshot por turno (CU-6/CU-7), con trazabilidad completa (qué turno, cuánto, en qué liquidación). El ítem conserva `monto_cobertura_centavos` + `saldo_paciente_centavos` + `cobertura_pct` copiados de la cobertura, de modo que el reintegro queda fijo aun si el plan cambia después. La invariancia `cobertura + saldo = total` la garantiza el CHECK de la tabla de cobertura; los payloads no incluyen nombres/DNI (R3). No se incluye una CHECK con subconsulta en el ítem (SQLite la admite en CREATE TABLE pero complica testing y se logra mejor en servicio + FKs).
**Historial de liquidación (decisión):** quedó pendiente evidenciar quién generó/presentó/pagó y cuándo con solo columnas sueltas; se adopta una **tabla de eventos append-only** (`obra_social_liquidacion_evento`) al estilo de `hc_evento`/`odontograma_evento` (C-09): un evento por generación ('generada', al pasar de ∅→`borrador`) y uno por cada transición de estado ('presentada', 'pagada'), cada uno con su `actor_usuario_id` y `ocurrido_en` (momento del evento de negocio), más un `created_at` NOT NULL como sello de inserción del registro — son campos distintos y ambos NOT NULL, siguiendo la convención real de C-09 y el contrato de `AppendOnlyRepository` de `src/shared/repository.ts` **[corr. 3ª ronda]**. Razones: (a) el historial no muere: resiste bajas lógicas de la cabecera y permite seguir agregando registros históricos sin ALTER de columnas; **agregar un nuevo valor de `evento` (p. ej. `observada`) no se resuelve así — exige revisar y posiblemente ampliar el CHECK `evento IN (...)` mediante una migración posterior**; (b) evita columnas nulas/ambiguas (`generada_por` ya queda en la cabecera como dato de fila, el resto de transiciones solo vive en la tabla de eventos); (c) es consultable como timeline ordenada del GET de detalle sin depender de `auditoria_phi` (D10). Los triggers `*_no_update`/`*_no_delete` (estilo C-09, sin `IF NOT EXISTS` siguiendo ese patrón) fuerzan la inmutabilidad: cualquier UPDATE/DELETE da error (financiero/auditoría: R2/R16-CRITICAL).
**Alternativas consideradas:** una sola tabla plana de liquidación (rechazada: snapshots incompatible con agregados por ítem); FK a `pago` (rechazada: acopla C-11 pendiente); FK a `presupuesto` (rechazada: C-10 descartado); columnas `presentada_por/fecha` + `pagada_por/fecha` en la cabecera (rechazada: fija al máximo 3 estados y no sobrevive a NEW estados en fase 2; el historial completo debe ser queryable sin columnas agregadas).

### D3. Cálculo en servicio puro con `BigInt`, no en triggers ni SQL

`calcularCobertura(montoTotalCentavos, coberturaPct)` devuelve `{cobertura_centavos, saldo_paciente_centavos}` con aritmética entera exacta: la multiplicación se hace en `BigInt` — `BigInt(montoTotalCentavos) * BigInt(coberturaPct) / 100n` — para que el producto intermedio no desborde `Number.MAX_SAFE_INTEGER` (R2/R5). La división de `BigInt` trunca, que para operandos no negativos equivale a `floor` (Decisión Q1 aprobada); "saldo = total − cobertura" se rehace en `number` después de la comprobación. Validaciones de entrada previas (R10/R2): monto entero `>= 0` con `Number.isSafeInteger` (así el total también es exacto) y pct entero 0..100 con CHECK del esquema. **Conversión segura de salida** [corr. 3ª ronda: sustituye la formulación anterior `Number(coberturaBigInt) === coberturaBigInt`, inválida — la igualdad estricta entre `number` y `bigint` es siempre `false` y rechazaría todo cálculo]: el límite se compara **en dominio `BigInt` antes de convertir**; si `coberturaBig > BigInt(Number.MAX_SAFE_INTEGER)`, la operación se rechaza con `400` (`monto no representable`) y el cargo no se registra; si no, `Number(coberturaBig)` es exacto. El guard es una barrera de exactitud: en `BigInt` nunca hay overflow aritmético (precisión arbitraria), pero el límite apunta a la conversión de salida — evita guardar nunca un `number` no exacto; los montos clínicos reales quedan órdenes de magnitud por debajo de 2^53, así que el rechazo es de probabilidad práctica nula. Los CHECKs del esquema son segunda línea de defensa (detectan inconsistencias, no calculan).
**Alternativas consideradas:** mantener `Math.floor(m * pct / 100)` con `number`. Rechazada: el producto intermedio `m * pct` puede exceder 2^53 con montos grandes (liquidaciones globales de OS) y la pérdida de exactitud sería silenciosa (R2); `Math.floor` protege el resultado, no la multiplicación. Trigger SQL de cálculo: rechazada por el mismo motivo que C-10 D4 — la lógica de negocio (RN-07) pertenece al servicio y al testing Vitest. Cents BCD/strings: innecesario con BigInt nativo.

### D4. Fuente del importe: `monto_total_centavos` declarado (sin catálogo), pendiente de C-15

**Razón:** C-15 (precios públicos) está pendiente y C-12 no debe duplicar catálogo ni inventar precios (**No evidenciado** nomenclador propio en la KB). El porcentaje del plan es también general [Comprobada KB-04 §7]: `obra_social_plan.cobertura_pct` no tiene variantes por prestación ni nomenclador, por lo que el cálculo RN-07 materializa la cobertura "por tratamiento" como ese porcentaje general aplicado al importe declarado de la prestación del turno; C-12 **no** implementa porcentajes diferenciales por tratamiento ni campo de nomenclador (Open Question 7; fase 2 con evidencia). El importe de la atención se declara al registrar el cargo, y puede corregirse vía PATCH mientras la cobertura no esté liquidada.
**Alternativa considerada:** crear tabla propia de tarifas por prestación/plan. Rechazada: duplica C-15 con riesgo de divergencia.

### D5. Snapshot de `cobertura_pct` y de montos al emitir (trazabilidad de reintegros)

El registro de cobertura guarda el `cobertura_pct` del momento (resiste cambios posteriores del plan); los ítems de liquidación copian montos/pct al generar y luego son inmutables (edición bloqueada con `409`). La liquidación presentada queda fija y auditable aunque después cambie el plan o se corrija la cobertura fuente.
**Alternativa considerada:** recalcular importes en la consulta (join con datos vigentes). Rechazada: pierde la fidelidad histórica del reintegro y permitiría que el pasado mutara silenciosamente.

### D6. Prevención de duplicaciones (reintegros y cargos)

Tres capas: (1) unicidad parcial por `turno_id` en coberturas (cargo único por turno); (2) unicidad parcial de liquidación por `(plan, desde, hasta)`; (3) unicidad parcial por `turno_id` en ítems de liquidación (`os_item_turno_liquidado_unico`), complementada por el servicio (al generar o agregar, se excluyen coberturas ya incluidas en liquidaciones vigentes). Todo considera la baja lógica (`WHERE deleted_at IS NULL`), de modo que re-emitir tras una baja lógica no choque con el índice.
**Alternativa considerada:** índices UNIQUE globales sin `WHERE`. Rechazados: bloquearían re-emisiones legítimas tras baja lógica.

### D7. RBAC (`src/shared/auth.ts`, patrón de matrices vigente)

- `ROLES_OS_PLAN_GESTION = ['administracion']` → POST/PATCH/DELETE de planes (R4: recepción NO configura).
- `ROLES_OS_PLAN_LECTURA = ['recepcion', 'profesional', 'administracion']` → GET planes.
- `ROLES_OS_COBERTURA_GESTION = ['recepcion', 'administracion']` → POST/PATCH coberturas (FL-04 paso 1: "En recepción").
- `ROLES_OS_COBERTURA_LECTURA`: todos los roles, con `profesional` acotado a turnos propios vía `usuario.profesional_id` (patrón `auth-roles` de C-03).
- `ROLES_OS_LIQUIDACION = ['administracion']` → ciclo completo de reintegros (FL-05: "Administración confirma").

**Alternativa considerada:** permitir que recepción genere borradores de liquidación. Rechazada: los reintegros son datos financieros próximos a la caja (R4/R16-CRITICAL; **No evidenciado** que recepción deba operarlos).

### D8. Arquitectura de módulo y repositorios (reutilizar `core/obraSocialPlan.repository.ts`, sin duplicar)

**Repositorio de planes existente [comprobado]**: `ObraSocialPlanRepository` vive en `src/core/obraSocialPlan.repository.ts` (C-02, R8: extends `BaseRepository<ObraSocialPlanRow>`, fila tipada en `src/core/models.ts`) con `buscarPorPlan`. C-12 **lo reutiliza y extiende en ese mismo archivo** (`listarTodos` para GET del CRUD, más los métodos de actualización/baja que el CRUD de planes necesite), **sin crear un repositorio duplicado de planes en `src/obras-sociales/`**. Los repos nuevos del módulo `src/obras-sociales/` (misma separación que `clinica/` y `agenda/`) son solo los cuatro nuevos: `CoberturaRepository` (`obra_social_cobertura_turno`), `LiquidacionRepository` (cabecera + consulta del historial vía la tabla de eventos), `LiquidacionItemRepository` y `LiquidacionEventoRepository` — este último **extendiendo `AppendOnlyRepository` de `src/shared/repository.ts`** (clase dedicada: `insert` sella `created_at`; `update`/`softDelete` lanzan `EventoInmutableError` 409 por diseño), con la inmutabilidad además respaldada por los triggers de D2. Los services por capacidad (`planes.service.ts`, `coberturas.service.ts`, `liquidaciones.service.ts`) concentran las reglas (RN-07 con `BigInt`, máquina de estados con evento por transición, exclusión de duplicados, validación plan–paciente con snapshot del pct) y el router Express se monta en `createApp` (`/api/obras-sociales/*`). Toda escritura con riesgo de carrera (registro de cargo, generación/agregado de ítems, cambio de estado + evento asociado) va dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`), consultando la unicidad en el repositorio antes del INSERT y confiando además en los índices únicos como segunda línea. Sin SQL fuera de repositorios (R8).
**Alternativas consideradas:** (1) crear `ObraSocialPlanRepository` de nuevo en `src/obras-sociales/`. Rechazada: dos fuentes de verdad para la misma fila de `obra_social_plan` (R8/divergencia + imports cruzados); [corr. 2ª ronda del owner: unificar]. (2) seguir extendiendo `core/` con los cuatro repos nuevos. Rechazada: `clinica/` y `agenda/` ya establecieron la convención de módulo por dominio; obras sociales es un ámbito propio (F-08) con endpoints y RBAC propios — solo el repo preexistente queda donde está.
**Nota**: la coordinación del UPDATE de `obra_social_liquidacion` con el INSERT del evento (quién/cuándo) ocurre en el mismo `UnitOfWork` para que una transición siempre produzca su evento, ver specs de liquidación.

### D9. Tipos de dominio (`shared/types.ts`)

Brand types `CoberturaTurnoId`, `LiquidacionOsId`, `LiquidacionOsItemId`; se reutilizan `TurnoId`, `PrestacionId`, `ObraSocialPlanId`, `UsuarioId`. Tipos `LiquidacionOsEstado` + `LIQUIDACION_OS_TRANSICIONES` alineados al patrón existente `PRESUPUESTO_TRANSICIONES`. Interfaces de fila junto al módulo (patrón `clinica/presupuestos.*`). Ningún campo monetario en float: solo `number` enteros con validación (R2/R5/R10).

### D10. Sin cambios en `auditoria_phi`

`auditoria_phi` (C-09) cubre recursos clínicos (`historia_clinica`, `odontograma`, `delegacion_hc`, `paciente`); las tablas OS referencian turnos por id y no exponen campos PHI propios, por lo que su CHECK `recurso IN (...)` queda intacto. La trazabilidad monetaria de liquidaciones se apoya en **tres capas propias**: snapshots de montos/pct (D5), actor + marcas temporales **solo donde el esquema 011 los tiene**: `generada_por_usuario_id` en la cabecera `obra_social_liquidacion` y `actor_usuario_id` en cada evento de `obra_social_liquidacion_evento` (quién/cuándo exacto, D2); **las filas de `obra_social_cobertura_turno` y `obra_social_liquidacion_item` no llevan actor** (solo columnas de auditoría `created_at`/`updated_at`/`deleted_at`) — el texto anterior afirmaba actor "en cada fila" y no coincide con el esquema real [corr. 3ª ronda]: añadir actor al cargo exigiría ALTER de esquema, decisión de fase 2 solo si el owner lo pide; en particular, quien generó queda doble-evidenciado (`generada_por_usuario_id` de la cabecera + evento 'generada') por diseño redundante. R3 sigue vigente (nunca PHI en logs/payloads de este módulo). Auditar lecturas de reintegros sería una decisión nueva, fuera de este change (pendiente).

### D11. Gobernanza CRITICAL (R16) — revisión humana explícita pre-merge

CHANGES.md declara ALTO y `AGENTS.md` R16 exige CRITICAL para obras sociales/liquidación; prevalece R16. El change queda bloqueado para merge hasta revisión humana explícita con foco en: exactitud de cálculos (centavos/saldo), prevención de duplicaciones de reintegros, trazabilidad y permisos (recepción sin configuración de planes). Esta preparación no ejecuta `/opsx:apply`.

## Risks / Trade-offs

- [Comprobada] Criterio de redondeo: **truncamiento de la división `BigInt` (equivalente a `floor` para no negativos)** — la OS paga el centavo cubierto completo y el saldo queda íntegramente al paciente. Decisión aprobada Q1. → Mitigación: una única función `calcularCobertura` con `BigInt` + test Dado/Cuando/Entonces que fija el comportamiento.
- [Riesgo] `paciente.obra_social_plan_id` es FK lógica (SQLite no permite agregar FK por ALTER en 004) → podría declararse un plan que el paciente no tiene. → Mitigación: el servicio valida la equivalencia paciente–plan y responde `400` (spec de cobertura); el CHECK SQL no reempliza esa validación por ser FK lógica.
- [Riesgo] Carrera concurrente: dos usuarios registran el cargo del mismo turno a la vez. → Mitigación: transacción `BEGIN IMMEDIATE` + índice único parcial `os_cobertura_turno_unica` (el segundo INSERT viola el índice → `409`), con test de doble registro sin mockear la transacción (R12).
- [Riesgo] Coexistencia de la 010 (C-11, archivada) con la 011: ambas entradas conviven en el array `MIGRATIONS` sin dependencia de datos entre sí (D1); el runner aplica por separado lo pendiente de cada una sea cual sea el orden de merge. → Mitigación: nota explícita en este design (independencia C-11/C-12) + test que valida la corrida completa 001→010→011.
- [Comprobada] Estado requerido para liquidar: **solo turnos con `estado = 'atendido'`** pueden incluirse en ítems de una liquidación. Se excluyen `reservado`, `confirmado`, `presente`, `cancelado` y `ausente`. Decisión aprobada Q4.
- [Trade-off] Sin catálogo de precios: el importe se declara y es corregible por PATCH antes de liquidar; la fuente canónica llegará con C-15.
- [Trade-off] Estados de liquidación: la máquina lineal 'borrador' → 'presentada' → 'pagada' (Decisión Q2 aprobada); estadios adicionales (observaciones, reconsideraciones) quedan para fase 2 con evidencia.

## Migration Plan

1. Agregar `MIGRATION_011_OBRAS_SOCIALES` con las **cuatro tablas** (cobertura, liquidación, ítems y eventos), sus CHECKs, índices e índices únicos parciales, y los triggers `os_evento_no_update`/`os_evento_no_delete` (estilo C-09); registrarla en `MIGRATIONS` después de la `010` de C-11 (sin alterar 001–010 ni insertar entradas ajenas) — **estado 05/11/2026 [comprobado]: ya registrada así**.
2. Correr `npm run typecheck` + `npm test` (SQLite en memoria aplica 001→010→011 vía `openDatabase` — la 010 existe desde el archivado de C-11; el orden no afecta el resultado por independencia D1).
3. Escenario Vitest de migración: abrir base, verificar tablas/columnas/CHECKs/índices/triggers de las cuatro tablas (patrón `migrations.test.ts` / `migrations_009.test.ts`).
4. Rollback (change nuevo, sin datos productivos aún): `DROP TABLE` de las cuatro tablas OS en orden de dependencia (`obra_social_liquidacion_evento` y `obra_social_liquidacion_item` primero, luego `obra_social_liquidacion` y `obra_social_cobertura_turno`); los triggers caen con su tabla automáticamente en SQLite. La tabla `schema_migrations` conserva la fila `011` — si se decidiera re-ejecutarla, borrarla (`DELETE FROM schema_migrations WHERE id = '011'`), tal como está documentado en tasks.

## Open Questions

1. **Criterio de redondeo de cobertura**: **[Comprobada — Decisión Q1]** truncamiento de la división `BigInt` (equivalente a `floor` para no negativos) — la OS paga hasta el centavo cubierto completo y el saldo completo queda al paciente. Implementado en `calcularCobertura`.
2. **Máquina de estados de liquidación**: **[Comprobada — Decisión Q2]** estados `borrador → presentada → pagada` aprobados como definitivos para este change. Estados adicionales diferidos a fase 2.
3. **Coberturas incluidas por período**: **[Comprobada — Decisión Q3]** el período se filtra por `turno.inicio` (fecha de atención), no por `created_at` de la cobertura. `created_at` se conserva exclusivamente para auditoría. El servicio de generación de borradores filtra coberturas cuyo turno tenga `inicio >= desde AND inicio <= hasta`.
4. **Restricción por estado del turno**: **[Comprobada — Decisión Q4]** solo turnos con `estado = 'atendido'` pueden incluirse en ítems de una liquidación. Se excluyen `reservado`, `confirmado`, `presente`, `cancelado` y `ausente`. El servicio filtra el join `obra_social_cobertura_turno JOIN turno ON turno.id = cobertura.turno_id WHERE turno.estado = 'atendido'`.
5. **Plan dado de baja con pacientes asignados** (FK lógica `paciente.obra_social_plan_id`): **[Comprobada — Decisión Q5]** baja lógica (`deleted_at` + `activo = 0`); las asignaciones históricas de pacientes se conservan intactas (sin reasignación forzada).
6. **Coordinación con C-11**: la caja ya existe (C-11 archivado 04/11/2026), pero la reconciliación entre los cobros con medio `obra_social` y las liquidaciones OS no está implementada y no pertenece a C-12; queda anotada como coordinación futura y **pendiente de aprobación humana (Q6)** para un change posterior.
7. **Nomenclador / cobertura por prestación**: **No evidenciado** en la KB (la cobertura por plan es lo único evidenciado); se difiere a fase 2 con PUCO/nomenclador si el owner lo valida.
