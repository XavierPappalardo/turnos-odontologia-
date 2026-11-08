# Design — C-13 `comisiones-profesional`

> El change hereda los patrones consolidados de C-11 (pagos, idempotencia, caja) y C-12 (liquidación con cabecera + ítems-snapshot + eventos append-only + una liquidación vigente por período). Este design registra las decisiones técnicas D1…D13 y las preguntas Q1…Q7, **todas RATIFICADAS por el owner el 2026-11-06** (ver tabla final).

## D1 — Base de cálculo: solo producción cobrada atribuible

- El único conjunto elegible son los pagos con `estado = 'cobrado'`, `deleted_at IS NULL`, `medio <> 'obra_social'` (Q1 ratificada: excluir) y **atribuibles a un profesional** vía `pago.turno_id → turno.profesional_id`.
- Los cobros parciales son soportados naturalmente: cada `pago` es una línea de liquidación (no se prorratean consolidados). La validación C-11 (`monto_excede_saldo`) ya garantiza que múltiples pagos conviven sobre un mismo turno/presupuesto.
- Exclusiones por diseño: pagos `pendiente` (aún no son producción cobrada), pagos `anulado` (el movimiento `anulacion` de caja solo deja trazabilidad, no producción), pagos sin atribución (ver D2), medio `obra_social`.
- **Q1 RATIFICADA por el owner (2026-11-06): EXCLUIR `obra_social` de la base.** El reintegro OS es dinero que la clínica percibe, pero compite semánticamente con la liquidación de reintegros de C-12 (FL-05 las define "en paralelo"): la comisión del MVP se calcula sobre lo efectivamente cobrado al paciente (medios `efectivo | tarjeta | transferencia | mercadopago`).
- **Q2 RATIFICADA por el owner (2026-11-06): exigir turnos `atendido`.** Solo se comisiona producción de turnos atendidos (condición homóloga a la del change C-12).

## D2 — Atribución profesional y prioridad general vs. por tratamiento (P1 de revisión)

Cadena real verificada en `backend/src/shared/migrations.ts` (001 + recreación de `pago` en 010): `pago.turno_id` y `pago.presupuesto_id` **pueden coexistir** — la CHECK real de 010 es de al menos uno (`turno_id IS NOT NULL OR presupuesto_id IS NOT NULL`), no de exclusividad mutua; `turno.profesional_id → profesional` (NOT NULL), `turno.prestacion_id → prestacion` (NULLABLE), `presupuesto.turno_id → turno` (NULLABLE), `item_presupuesto` descriptivo **sin FK a `prestacion`**. No se inventan FKs nuevas.

- Pago por **turno** (`pago.turno_id`): la atribución al profesional SIEMPRE existe (`turno.profesional_id`). Si `turno.prestacion_id` está seteado → regla por tratamiento de `(profesional, prestación)` si existe config vigente; si no, % general (RN-08: específico reemplaza al general; nunca se suman). Turno sin `prestacion_id` → % general.
- Pago por **presupuesto** (`pago.presupuesto_id`): la atribución solo es posible vía `presupuesto.turno_id`. Si ese turno pertenece al profesional → ítem con **% general** (no hay detalle por prestación: `item_presupuesto` no referencia `prestacion`). Si `presupuesto.turno_id` es NULL o apunta a un turno de OTRO profesional → **no atribuible**: excluido y reportado como descarte en la vista previa.
- **P1 concluye: NO requiere ampliar scope.** La atribución fina por ítems de presupuesto exigiría `item_presupuesto → prestacion` (toca C-10/C-15) y queda deferida a C-15; el comportamiento aquí es explícito y conservador — nunca se asigna comisión por heurísticas ni por ítems de presupuesto.
- **Doble referencia (`turno_id` + `presupuesto_id` en el MISMO pago) — política ratificada por el owner (ronda post-Bloque 1, 2026-11-06).** Como la CHECK real permite coexistir, la resolución es determinista: (a) si `pago.turno_id` está seteado, es la **referencia principal** → atribución por turno (regla por tratamiento si corresponde); el `presupuesto_id` del mismo pago NO se re-procesa (queda trazado solo en la FK del pago). (b) Coexistencia compatible (`presupuesto.turno_id` = `pago.turno_id`, o `presupuesto.turno_id` NULL): un único ítem, por el turno del pago. (c) Coexistencia **incompatible**: `presupuesto.turno_id` seteado y ≠ `pago.turno_id` → el pago se **excluye de la preview con motivo de descarte explícito** (nunca se atribuye por heurística ni se excluye en silencio). (d) `pago.turno_id` NULL → rama presupuesto de P1: atribución solo vía `presupuesto.turno_id` (% general si es del profesional; descarte si no). (e) Se mantiene `UNIQUE (pago_id) WHERE deleted_at IS NULL` en el ítem: a lo sumo un ítem activo por pago — anti doble-comisión.
- Un cambio de `turno.prestacion_id` después del borrador no reescribe snapshots ya persistidos (D4): la regeneración del borrador recalcula con datos vigentes.

## D3 — Fecha que determina el período (Q3 ratificada)

- `movimiento_caja.fecha_contable` del movimiento tipo `cobro` del pago delimita `[desde, hasta]` (RN-09): comisión sobre producción **cobrada**, coherente con el día contable de caja. Los cobros C-11 siempre generan movimiento (`pago_id NOT NULL`); el fallback documentado para pagos sin movimiento (datos previos a 010) es `pago.created_at` (no requerido en MVP).
- **Q3 RATIFICADA por el owner (2026-11-06): `fecha_contable`.** Cambiar el criterio a futuro es solo un cambio de columna en el filtro.

## D4 — Snapshot y cambios posteriores

- Al **generar el borrador**, cada ítem congela: `turno_id`, `monto_cobro_centavos`, `pct_aplicado`, `regla_aplicada` (`general` | `tratamiento`), `monto_comision_centavos`, `fecha_contable`. El borrador es **re-generable** (idempotente): recalcular reemplaza los ítems con los % vigentes y descarta cobros que dejaron de ser elegibles (anulados, etc.).
- Al **confirmar**, el snapshot queda congelado. Un cobro anulado después de confirmar **no retrae** la liquidación: emerge un ajuste compensatorio para la liquidación futura (D12). Queda fuera del MVP la edición retroactiva de una liquidación confirmada (**Q4 RATIFICADA: compensación por ajuste en liquidación futura — ver D12**).
- Cambios de % posteriores a una confirmación no alteran liquidaciones previas; los cálculos nuevos usan el % vigente.

## D5 — Estados y reglas de confirmación

- Estados lineales: `borrador → confirmada` (terminal). Quedan fuera del MVP los estados `pagada` y `anulada`; el pago efectivo al profesional no se registra en el sistema.
- La confirmación es única vía `POST /liquidaciones/:id/confirmar`, solo administracion, intra-transacción (D7), comprobando estado `borrador` y re-derivando el fingerprint del cálculo sobre datos vivos con igualdad contra el snapshot del borrador antes de marcar (patrón F1 de C-12 refinado por D13: discrepancia → `409 preview_desactualizado`), y registrando el evento `confirmada`.

## D6 — Permisos (R4)

- `ROLES_COM_CONFIG: ['administracion']` — configurar % (general y por tratamiento). Recepción y profesional explícitamente fuera (R4: la recepción NO configura comisiones).
- `ROLES_COM_GESTION: ['administracion']` — preview / generar / regenerar / confirmar / consultar todas.
- Profesional: consulta **solo sus propias liquidaciones** — el scoping se fuerza por `usuario.profesional_id` en el backend (nunca por body), y solo ve **confirmadas** (**Q6 RATIFICADA por el owner, 2026-11-06**).
- Logs y respuestas: sin PHI (R3): ids internos opacos; en errores, sin montos sensibles ni nombres.

## D7 — Prevención de duplicaciones y concurrencia (Q7 ratificada)

- Cabecera: `UNIQUE (profesional_id, desde, hasta) WHERE deleted_at IS NULL` → una liquidación vigente por profesional + período exacto (patrón C-12).
- Ítems: `UNIQUE (pago_id) WHERE deleted_at IS NULL` → **un cobro solo puede estar en una liquidación vigente** (anti doble-comisión; equivalente al guard "un turno en una sola liquidación" de C-12).
- Generar / regenerar / confirmar corren dentro de `UnitOfWork` con `BEGIN IMMEDIATE` (R12) y re-verifican todo intra-tx (estado de cabecera, elegibilidad de cada cobro, disponibilidad del cobro — si otro profesional/liquidación lo tomó primero → conflicto explícito).
- Períodos **solapados** del mismo profesional (p. ej. `[15-11, 20-11]` y `[1-11, 30-11]`) no se rechazan: el guard de cobro-único impide doble pago; el solapamiento solo limita la cobertura temporal. Opción dura (rechazar solapamiento activo) queda **descartada — Q7 RATIFICADA por el owner (2026-11-06): solo guard de cobro-único**; el doble-pago por cobro es imposible por `UNIQUE(pago_id)`.
- Vista previa (`preview`) es un cálculo en vivo **sin persistencia** (idempotente, sin efectos).

## D8 — Aritmética R2/R5/R6 (Q5 ratificada)

- Montos enteros en centavos ARS; `%` enteros 0..100 (CHECK en DDL).
- Comisión por ítem = `trunc(monto_cobro_centavos × pct_aplicado / 100)` — **truncado (floor) hacia abajo** (**Q5 RATIFICADA por el owner, 2026-11-06**).
- Total de cabecera = Σ exacta de los ítems vigentes menos los ajustes (D9/D12), recomputada intra-tx al confirmar (nada se confía del borrador previo).
- Descarte: no se usan float/double nunca (R2).

## D9 — Modelo — Migración 012 (se crea en fase `/opsx:apply`; este change NO la crea ahora)

```
profesional_comision                 -- % general por profesional (config activa única)
  id, profesional_id UNIQUE WHERE deleted_at IS NULL (parcial),
  pct_general INTEGER CHECK 0..100, created_at, updated_at, deleted_at
profesional_comision_tratamiento     -- % por (profesional, prestación)
  id, profesional_id, prestacion_id, pct INTEGER CHECK 0..100,
  created_at, updated_at, deleted_at,
  UNIQUE (profesional_id, prestacion_id) WHERE deleted_at IS NULL
liquidacion_comision                 -- cabecera por profesional + período
  id, profesional_id, desde, hasta CHECK (hasta >= desde),
  estado CHECK ('borrador','confirmada'),
  monto_items_centavos INTEGER CHECK >= 0,
  monto_ajustes_centavos INTEGER CHECK >= 0,
  monto_total_centavos,               -- neto = items - ajustes (puede ser < 0 solo por ajustes)
  saldo_compensacion_centavos INTEGER NOT NULL DEFAULT 0 CHECK (saldo_compensacion_centavos >= 0),
    -- CHECK: 0 en 'borrador'; en 'confirmada' = max(0, ajustes - items) (CASE, no MIN)
  fingerprint TEXT NOT NULL,          -- D13: hash del cálculo al generar/regenerar
  created_at, updated_at, deleted_at,
  UNIQUE (profesional_id, desde, hasta) WHERE deleted_at IS NULL
liquidacion_comision_item            -- snapshot inmutable por cobro
  id, liquidacion_id, pago_id, turno_id,
  fecha_contable TEXT NOT NULL CHECK GLOB 'YYYY-MM-DD',   -- snapshot D4 (mov. caja; fallback pago.created_at)
  monto_cobro_centavos, pct_aplicado,
  regla_aplicada CHECK ('general','tratamiento'), monto_comision_centavos,
  created_at, deleted_at,
  UNIQUE (pago_id) WHERE deleted_at IS NULL
liquidacion_comision_ajuste          -- D12: reserva exclusiva + compensación por anulación
  id, liquidacion_id, item_origen_id, pago_id,
  tipo_ajuste CHECK ('anulacion_cobro','saldo_arrastre'),
  monto_ajuste_centavos INTEGER CHECK > 0,    -- magnitud declarada (comisión original o residual)
  monto_compensado_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (monto_compensado_centavos >= 0 AND monto_compensado_centavos <= monto_ajuste_centavos),
  estado_ajuste CHECK ('reservado','consumido'),
  compensado_en TEXT
    CHECK (estado_ajuste = 'reservado' OR (estado_ajuste = 'consumido' AND compensado_en IS NOT NULL)),
  created_at, updated_at, deleted_at,
  UNIQUE (item_origen_id, liquidacion_id) WHERE deleted_at IS NULL    -- sin duplicados en el host
  + índice único parcial: (item_origen_id) WHERE deleted_at IS NULL AND estado_ajuste = 'reservado'
  -- => garante a nivel de BD de que un ajuste está reservado como máximo por UN borrador activo
liquidacion_comision_evento          -- append-only: quién/cuándo (estilo C-12, R4)
  id, liquidacion_id, evento CHECK ('generada','confirmada'),
  actor_usuario_id, ocurrido_en, created_at
  + triggers insert-only (no_update / no_delete)
```

- FKs solo hacia core 001–010 (todas `id TEXT`, patrón C-12 D2); índices: ítems por `liquidacion_id` y `pago_id`; ajustes por `liquidacion_id` e `item_origen_id`; cabecera por `(profesional_id, estado)` y `(desde, hasta)`.
- `turno_id`/`fecha_contable`/`monto_cobro_centavos`/`pct_aplicado` son **snapshot de valor** (no FK funcional): históricos inmutables; `fecha_contable` usa el mismo formato GLOB `YYYY-MM-DD` que `movimiento_caja.fecha_contable` (010).
- Los componentes de monto cumplen R5 (mayor o igual a 0, enteros); `monto_total_centavos` es el neto y puede ser negativo SOLO cuando hay ajustes (excepción documentada a R5; la identidad se asegura con CHECK de tabla `monto_total = monto_items - monto_ajustes`; sin floats, R2).
- Soporte transaccional de la reserva (P2): la fila `estado_ajuste = 'reservado'` se crea en la MISMA tx `BEGIN IMMEDIATE` de la generación del borrador; el índice único parcial sobre `item_origen_id` restringe la reserva activa a un único borrador; la baja lógica del borrador libera sus ajustes (mismos `deleted_at`, misma tx); la confirmación fija `estado_ajuste = 'consumido'` + `compensado_en` (la reserva queda consumida).

## D10 — Módulos y contratos (fase apply)

- `backend/src/comisiones/`: `configuraciones.{routes,service}.ts`, `liquidaciones.{routes,service}.ts`, `calculo.ts` (función pura de cálculo), `fingerprint.ts` (hash determinista, D13), `config.repository.ts`, `configTratamiento.repository.ts`, `liquidacion.repository.ts`, `liquidacionItem.repository.ts`, `liquidacionAjuste.repository.ts`, `liquidacionEvento.repository.ts`, `errors.ts`.
- Extensión read-only en `backend/src/core/pago.repository.ts`: `listarCobrosElegiblesComision(profesionalId, desde, hasta)` — JOIN turno (R8: SQL solo en repositorios).
- Rutas: `PUT|GET /api/comisiones/configuraciones/:profesionalId`, `POST /api/comisiones/preview` (responde `fingerprint`), `POST /api/comisiones/liquidaciones` (exige `fingerprint`), `POST /api/comisiones/liquidaciones/:id/regenerar` (exige `fingerprint`), `POST /api/comisiones/liquidaciones/:id/confirmar` (exige `fingerprint`), `GET /api/comisiones/liquidaciones(+/:id)`, `GET /api/comisiones/mis-liquidaciones`.
- Errores (estilo `CajaErrorCode` de C-11): `validacion`, `not_found`, `estado_invalido`, `cobro_ya_liquidado`, `periodo_ya_liquidado`, `sin_configuracion`, `identidad_ya_configurada`, `preview_desactualizado` (409/422/404 según corresponda).

## D11 — Testing (R11/R12)

- Toda regla con escenario Vitest `Dado/Cuando/Entonces`; SQLite real en memoria; sin mocks de transacciones; fixtures ficticios (R1/R12).
- Suites: `comisiones_config` (RBAC + unicidad + rango de %), `comisiones_calculo` (prioridad, exclusión medio OS [Q1], exclusión anulados/pendientes, parciales por pago, truncado [Q5], cambio de % mid-período), `comisiones_fingerprint` (determinismo + sensibilidad a cada input: %, cobros, ajustes), `comisiones_liquidacion` (generar/regenerar/confirmar, duplicación de cobro entre profesionales, solapamiento [Q7], terminalidad, ajustes compensatorios: inclusión/idempotencia/inmutabilidad del original), `comisiones_routes` (401/403/404/409/422, incl. `409 preview_desactualizado`), `migrations_012` (DDL 6 tablas, CHECKs incl. identidad del neto, UNIQUE parciales, triggers, registro al final del array).

## D12 — Ajustes compensatorios por anulación posterior (Q4 ratificada; P1/P2 de revisión)

Ciclo de vida del ajuste = **reservado → consumido** (la liberación es la baja lógica del borrador portador):

- **Reserva (P2).** Al generar la `borrador`, cada ajuste elegible se inserta como fila `estado_ajuste = 'reservado'` (`liquidacion_id` → esa cabecera) en la MISMA transacción `BEGIN IMMEDIATE` (R12). El índice único parcial `(item_origen_id) WHERE deleted_at IS NULL AND estado_ajuste = 'reservado'` garantiza a nivel de BD que un ajuste nunca pertenece a dos borradores activos. Con períodos solapados, la segunda generación concurrente corre intra-tx serializada: la reserva cambia el conjunto elegible, así que su `fingerprint` re-derivado difiere del enviado → `409 preview_desactualizado` (NUNCA continúa excluyendo en silencio; el cálculo generado sigue al revisado, D13). Tras una nueva preview —cuyo fingerprint ya incorpora la exclusión del ajuste reservado— la generación procede normalmente sin ese ajuste; si el primer borrador se descarta, el ajuste vuelve a estar pendiente.
- **Liberación.** La baja lógica del borrador portador marca `deleted_at` en cabecera e ítems **y en sus filas de ajuste, en la misma transacción**: la reserva se libera y el ajuste vuelve a ser pendiente para la próxima generación.
- **Consumo (confirmación — P1).** Dentro de la tx de confirmación se hace la **absorción in-order**: orden determinista por `pago.anulado_en ASC, pago_id ASC`; presupuesto = `monto_items_centavos`; fila a fila se asigna `monto_compensado_centavos` (la del límite puede absorberse parcialmente: `0 <= compensado <= monto`), se marca `estado = 'consumido'` + `compensado_en`. La reserva queda consumida y fijada a la cabecera ahora `confirmada`.
- **Saldo (P1) — representación.** Si `monto_ajustes > monto_items`: NO se anula la confirmación ni se emite deuda negativa; se absorbe lo posible y la confirmada registra `saldo_compensacion_centavos = monto_ajustes - monto_items` (CHECK obliga a 0 en borrador y a esa identidad en confirmada). El neto `monto_total_centavos` puede ser negativo — es una cifra de registro, no un pago.
- **Saldo (P1) — sin pagos negativos automáticos.** El sistema NO genera pagos/bonificaciones negativos: el flujo de desembolso real no existe en el MVP (D5) y el saldo es un importe totalmente pasivo. Su único efecto es **reducir comisiones futuras**: las generaciones posteriores detectan el saldo pendiente por fila (`monto_ajuste - monto_compensado` de filas consumidas) y lo incluyen como fila nueva `tipo_ajuste = 'saldo_arrastre'` con `monto = saldo restante` (snapshot), con la misma reserva exclusiva. Si nunca hay comisiones futuras, el saldo queda registrado sin efecto automático (cualquier decisión manual queda fuera del alcance).
- **Detección de "pendientes".** En preview/generar/regenerar/confirmar los ajustes elegibles son: (a) anulaciones originales sin fila `reservado` activa para su `item_origen_id`; (b) saldos de arrastre (restos pendientes > 0 de filas consumidas). Los `reservados` por otro borrador quedan excluidos del conjunto vivo; generar contra un fingerprint previo a esa exclusión → `409 preview_desactualizado` (D12/D13).
- **Cobro anulado ANTES de la confirmación** (todavía en `borrador`): NO genera ajuste; se descarta el ítem al regenerar. La detección (a)/(b) solo cubre ítems ya en `confirmada`.
- **Trazabilidad.** Cada fila de ajuste referencia `item_origen_id` + `pago_id` de la comisión original confirmada, con `monto`, `compensado`, estado y fecha de absorción; la cabecera portadora registra su evento `generada`/`confirmada` con actor. No hay nuevo tipo de evento (trazabilidad por referencia, estilo C-12).

## D13 — Fingerprint del cálculo (preview / generar / regenerar / confirmar)

- El fingerprint es un `SHA-256` sobre JSON canónico de: `{profesional_id, desde, hasta}` + config general vigente (`id`, `updated_at`, `pct_general`) + tratamientos vigentes (ordenados por `prestacion_id`) + cobros elegibles (`id`, `monto_centavos`, `medio`, `fecha_contable`, ordenados por id) + ajustes pendientes (`pago_id`, `item_origen_id`, `monto`, ordenados — los `reservados` por otro borrador quedan excluidos, P2). Implementación pura en `fingerprint.ts` (`node:crypto`; sin estados aleatorios ni timestamps en la semilla). Distintos inputs → distinto hash; mismos inputs → mismo hash.
- `POST /preview` responde `fingerprint`. `POST /liquidaciones`, `POST .../:id/regenerar` y `POST .../:id/confirmar` lo **exigen** en el body (se garantiza confirmar el cálculo que la administración revisó): si el cálculo vivo re-derivado intra-tx difiere → `409 preview_desactualizado` sin persistir; la administración debe re-previsualizar (y regenerar si aplica). No existe camino que confirme un cálculo distinto del revisado.
- Persistencia: `liquidacion_comision.fingerprint` guarda el hash al generar/regenerar (auditoría; se reemplaza con cada regeneración).
- Concurrencia: dos administradores con preview en paralelo — `BEGIN IMMEDIATE` serializa; quien persiste segundo o presenta un fingerprint ya-antiguo recibe el mismo `409`. Un %, un cobro o la **reserva de un ajuste por otra generación** cambiados entre preview y confirmación producen `409` (nunca silencio): una vez pasa el fingerprint, se congela el snapshot del borrador y la re-derivación queda como doble verificación.
- El fingerprint hace determinista el flujo aunque Q7 permita períodos solapados: la disponibilidad del cobro se re-verifica intra-tx con los guards (D7); un conflicto de cobro → `409 cobro_ya_liquidado`, de período → `409 periodo_ya_liquidado`.

## Q1…Q7 — RATIFICADAS por el owner (2026-11-06)

| # | Pregunta | Decisión ratificada |
|---|---|---|
| Q1 | ¿El medio `obra_social` entra en la base de comisión? (ver D1) | **Excluir** — comisión sobre lo efectivamente cobrado al paciente |
| Q2 | ¿Condicionar ítems a turnos `atendido` únicamente? | Exigir `atendido` (homólogo C-12) |
| Q3 | ¿Período por fecha contable de caja o por `turno.inicio`? | `fecha_contable` del cobro |
| Q4 | ¿Política post-confirmación ante anulaciones? | **Ajustes compensatorios en liquidación futura (D12)**; la confirmada nunca se modifica |
| Q5 | ¿Redondeo del ítem: truncado (floor) o half-up? | Truncado (floor) hacia abajo |
| Q6 | ¿El profesional ve borradores propios en portal? | Solo confirmadas |
| Q7 | ¿Períodos solapados del mismo profesional? | Permitidos; guard cobro-único evita doble comisión |
