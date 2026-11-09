# Design — C-14 reportes-ocupacion-facturacion-ausentismo

## Context

Ver `proposal.md` para la motivación. Estado actual que condiciona el diseño:

- `turno` (migración 003) almacena `inicio` y `fin` como TEXT ISO-8601 **UTC**, `estado` con seis valores (`reservado`, `confirmado`, `presente`, `atendido`, `cancelado`, `ausente`) y `deleted_at` (004). Índices existentes: `idx_turno_prof_intervalo(profesional_id, inicio, fin)` y `idx_turno_sillon_intervalo(sillon_id, inicio, fin)`.
- `prestacion` **no tiene precio** (`codigo`, `nombre`, `duracion_min`). No existe forma de calcular facturación devengada por turno hasta C-15.
- `pago` (rebuild 010) tiene `monto_centavos`, `moneda`, `medio` y `estado`; `movimiento_caja` es append-only con triggers, guarda `tipo ∈ {cobro, anulacion}` con `monto_centavos` **siempre positivo** y dos fechas: `fecha_contable` (día del servicio) y `aplicado_en` (día en que el movimiento impacta la caja).
- `caja.service.resumenPorDia(fecha)` ya agrupa por `aplicado_en` vía `movimientos.listarPorFechaAplicada(fecha)` y netea anulaciones restando `monto_centavos`. C-14 debe replicar esa semántica, no inventar otra.
- `shared/fechas.ts` expone `fechaContable(instantIsoUtc, zona)`, función pura basada en `Intl.DateTimeFormat('en-CA', …)` que devuelve `YYYY-MM-DD` en la zona configurada. Es el mecanismo testeado que usa C-11 para asignar día local.
- `config.caja.zonaHoraria` existe y se valida como zona IANA al arranque (`CAJA_ZONA_HORARIA`, default `America/Buenos_Aires`).
- `usuario.profesional_id` existe (migración 011) y `clinica/resolverProfesional.ts` resuelve el profesional del usuario autenticado.
- `shared/auth.ts` centraliza la matriz RBAC; `shared/app.ts` monta los routers bajo `/api`; `error-handler.ts` serializa cualquier `AppError` sin stack ni PHI.
- `BaseRepository<T>` + `UnitOfWork` en `shared/repository.ts`; R8 exige que todo SQL viva en un repositorio.

Restricciones duras aplicables: R2/R5 (montos en centavos enteros, nunca float), R6 (porcentajes enteros exactos), R8 (SQL solo en repositorios), R10 (TS estricto, sin `any` injustificado), R11 (escenarios Vitest Dado/Cuando/Entonces), R12 (SQLite real en memoria, sin mockear transacción), R3 (sin PHI en respuestas, logs ni query params).

## Goals / Non-Goals

**Goals:**

- Tres lecturas agregadas deterministas, con contrato JSON explícito y validación de entrada.
- Reutilizar la semántica de caja existente para que la facturación nunca diverja del cierre diario.
- Aislar toda la aritmética temporal en funciones puras testeables.
- Cero migraciones, cero escrituras, cero dependencias nuevas.

**Non-Goals:**

- Capacidad teórica, horarios de atención, grillas de slots o cualquier denominador de ocupación.
- Facturación devengada, rentabilidad, comisiones o cualquier métrica que dependa de C-13/C-15.
- Cancelación tardía, estados nuevos o columnas nuevas.
- UI, gráficos, exportación CSV, tablas materializadas.

## Decisions

### D1 — Alcance estrictamente read-only, sin migración

Los tres reportes son `SELECT` agregados. No se agregan tablas, columnas, estados, triggers ni índices. Toda la información necesaria ya está persistida.

- **Alternativa descartada — campo `cancelado_en` + `cancelacion_tardia`**: permitiría el ausentismo de FL-02, pero exige migración y toca la máquina de estados de C-06 (governance MEDIUM). Se descarta por decisión explícita del usuario.
- **Alternativa descartada — `precio` en `prestacion` para devengado**: pertenece a C-15 y rompería el aislamiento del change.

### D2 — Agregación on-the-fly, sin materialización

Cada request ejecuta las consultas agregadas contra las tablas base. El segmento objetivo es 1–10 profesionales; el volumen anual de `turno` y `movimiento_caja` es de miles de filas, no millones.

- **Alternativa descartada — tabla `reporte_snapshot`**: agrega escrituras, job de refresco e invalidación, y convierte un change LOW en uno con estado propio. No se justifica con este volumen.
- Consecuencia aceptada: el costo de cómputo crece con el rango consultado. Se acota con el límite de D9.

### D3 — Ocupación: minutos absolutos, sin denominador

```
minutos_ocupados = Σ (fin − inicio) en minutos enteros
  WHERE inicio cae en el rango local
    AND estado ∈ ('reservado','confirmado','presente','atendido')
    AND deleted_at IS NULL
```

- Los cuatro estados incluidos son los que **ocupan agenda** según KB-04 §5.4; `atendido` ocupó tiempo real en el pasado aunque hoy libere el hueco hacia adelante.
- `cancelado` y `ausente` **no** suman ocupación: el turno no consumió el recurso.
- No se reporta porcentaje: sin capacidad de referencia, cualquier `pct` sería ficción. El consumidor decide qué hacer con los minutos.
- Desglose por `profesional_id` y por `sillon_id` además del total, porque el roadmap pide "ocupación por profesional/sillón".
- **Alternativa descartada — ventana configurable (09:00–19:00 × profesionales × días)**: introduce configuración nueva y un supuesto de horario que el modelo no respalda; viola la decisión de no inventar capacidad.
- **Alternativa descartada — grilla de slots de paso configurable**: inventa granularidad y produce métricas que no se corresponden con turnos reales de duración variable (RN-03).

### D4 — Bucketing temporal: servicio puro sobre `fechaContable`, no SQL con timezone

`turno.inicio` está en UTC; agrupar por día local en SQL requeriría hardcodear el offset o usar funciones de fecha no portables. Se separa en dos etapas:

1. **Filtro grueso en SQL** (repositorio): `inicio >= (desde − 1 día) 00:00Z` y `inicio < (hasta + 2 días) 00:00Z`. Cubre cualquier offset IANA entre −12 y +14 con margen.
2. **Filtro fino y bucketing en servicio puro**: cada fila se asigna a su día local con `fechaContable(inicio, config.caja.zonaHoraria)`; se descarta si cae fuera de `[desde, hasta]`; la clave de grupo se deriva de esa fecha local.

- `periodo.ts` expone funciones puras: `validarRango`, `claveDeGrupo(fechaLocal, granularidad)`, `diasEntre`, `claveSemanaIso`.
- `semana` usa ISO-8601 (`YYYY-Www`, lunes como primer día) calculado sobre la fecha local, no sobre el instante UTC.
- **Alternativa descartada — `strftime('%Y-%m-%d', inicio, '-3 hours')`**: hardcodea el offset y rompe con cualquier zona con DST o configuración distinta.
- **Trade-off aceptado**: el repositorio devuelve columnas mínimas (`profesional_id`, `sillon_id`, `inicio`, `fin`, `estado`) y la agregación ocurre en memoria. Es proporcional al límite de rango de D9.

### D5 — Facturación: percibida por `aplicado_en`, neta de anulaciones

```sql
SELECT m.aplicado_en,
       SUM(CASE WHEN m.tipo = 'cobro' THEN m.monto_centavos ELSE 0 END) AS cobros,
       SUM(CASE WHEN m.tipo = 'anulacion' THEN m.monto_centavos ELSE 0 END) AS anulaciones,
       p.medio
  FROM movimiento_caja m
  JOIN pago p ON p.id = m.pago_id
 WHERE m.aplicado_en BETWEEN ? AND ?
 GROUP BY m.aplicado_en, p.medio
```

- `ingresos_netos_centavos = cobros − anulaciones`. Ambos son enteros; nunca float (R2).
- Se agrupa por `aplicado_en` porque es el día en que el dinero impacta la caja, y es exactamente lo que hace `GET /caja/resumen`. Agrupar por `fecha_contable` daría "producción del día del servicio" y **no** cuadraría con el cierre.
- `movimiento_caja` no tiene `medio`: se obtiene uniendo `pago` por `pago_id`. Es un `JOIN`, no una desnormalización.
- Desglose por medio con los cinco valores del `CHECK`; `bolsillo_centavos` = efectivo + tarjeta + transferencia + mercadopago; `obra_social_centavos` = medio `obra_social`.
- `aplicado_en` ya es `YYYY-MM-DD` local (verificado por `GLOB` en el esquema), por lo que **este** reporte filtra y agrupa en SQL sin matemática de zona horaria. La asimetría con D4 es deliberada y se documenta.
- **Alternativa descartada — `fecha_contable`**: mezclaría cobros asignados a días ya cerrados con el día real del ingreso y rompería la conciliación con `cierre_caja`.
- **Alternativa descartada — sumar `pago.monto_centavos` filtrando `estado='cobrado'`**: pierde el rastro append-only y no contempla correctamente las anulaciones posteriores. `movimiento_caja` es la fuente autoritativa.

### D6 — Ausentismo: solo `ausente`, sobre turnos resueltos

```
ausentes   = COUNT(estado = 'ausente' AND inicio en rango AND deleted_at IS NULL)
resueltos  = COUNT(estado ∈ ('atendido','ausente') AND inicio en rango AND deleted_at IS NULL)
tasa_ausentismo_pct = round_half_up(ausentes * 100 / resueltos)   -- entero 0..100
                      null si resueltos = 0
```

- El denominador son los turnos **resueltos** (`atendido` o `ausente`). Los turnos aún abiertos (`reservado`, `confirmado`, `presente`) no tienen resultado conocido y no se inventan como ausencias.
- `cancelado` queda fuera del numerador y del denominador. Es la consecuencia directa de descartar la cancelación tardía: **el reporte no distingue cancelación anticipada de ausencia**, y eso se documenta como limitación conocida.
- `tasa_ausentismo_pct` es **derivada, nunca persistida**; se emite como entero 0..100 para respetar R6. El redondeo es half-up y tiene escenario propio.
- Con `resueltos = 0` se devuelve `null`, no `0`: "no hay datos" ≠ "0 % de ausentismo".
- **Alternativa descartada — `ausente` + `cancelado`**: infla la métrica y exige un umbral de anticipación que hoy no está persistido.
- **Alternativa descartada — `updated_at` como proxy del instante de cancelación**: funciona por accidente hoy (los estados terminales no se vuelven a tocar) y se rompe ante cualquier escritura futura. No se usa.

### D7 — Contrato de endpoints

Base: `/api/reportes`. Todos `GET`, autenticados, `snake_case`, montos en centavos, minutos y cantidades enteros. `granularidad` default `dia`.

**`GET /api/reportes/ocupacion?desde=&hasta=&granularidad=&profesional_id=&sillon_id=`**

```json
{
  "desde": "2026-11-01",
  "hasta": "2026-11-07",
  "granularidad": "dia",
  "zona_horaria": "America/Buenos_Aires",
  "total": { "turnos": 41, "minutos_ocupados": 1230 },
  "series": [{ "clave": "2026-11-01", "turnos": 9, "minutos_ocupados": 300 }],
  "por_profesional": [{ "profesional_id": "<uuid>", "turnos": 20, "minutos_ocupados": 600 }],
  "por_sillon": [{ "sillon_id": "<uuid>", "turnos": 21, "minutos_ocupados": 630 }]
}
```

**`GET /api/reportes/facturacion?desde=&hasta=&granularidad=&medio=`**

```json
{
  "desde": "2026-11-01",
  "hasta": "2026-11-07",
  "granularidad": "dia",
  "zona_horaria": "America/Buenos_Aires",
  "total": {
    "cobros": { "cantidad": 12, "centavos": 1300000 },
    "anulaciones": { "cantidad": 1, "centavos": 50000 },
    "ingresos_netos_centavos": 1250000,
    "bolsillo_centavos": 750000,
    "obra_social_centavos": 500000
  },
  "por_medio": {
    "efectivo": 300000, "tarjeta": 200000, "transferencia": 100000,
    "mercadopago": 150000, "obra_social": 500000
  },
  "series": [{ "clave": "2026-11-01", "ingresos_netos_centavos": 120000 }]
}
```

**`GET /api/reportes/ausentismo?desde=&hasta=&granularidad=&profesional_id=`**

```json
{
  "desde": "2026-11-01",
  "hasta": "2026-11-07",
  "granularidad": "dia",
  "zona_horaria": "America/Buenos_Aires",
  "total": { "ausentes": 4, "resueltos": 40, "tasa_ausentismo_pct": 10 },
  "series": [{ "clave": "2026-11-01", "ausentes": 1, "resueltos": 9, "tasa_ausentismo_pct": 11 }],
  "por_profesional": [{ "profesional_id": "<uuid>", "ausentes": 2, "resueltos": 20, "tasa_ausentismo_pct": 10 }]
}
```

Reglas transversales del contrato:

- `series` incluye **solo claves con datos**, ordenadas ascendente. No se rellenan ceros.
- `series` nunca se filtra por `profesional_id`/`sillon_id` cuando hay desglose: el filtro de dimensión acota `total` y `por_*`, y se refleja en `series` solo si la dimensión es única. Se documenta en los escenarios.
- Respuesta sin PHI: solo ids opacos y agregados (R3). Ningún `paciente_id`, nombre, DNI ni `turno_id` individual.
- Rango vacío → `total` en ceros, `series: []`, `por_*: []`. Nunca `404`.

### D8 — Módulo `reportes/` y capas

```
backend/src/reportes/
  periodo.ts                 ← funciones puras (rango, claves de grupo, ISO week)
  reportes.repository.ts     ← todo el SQL (R8)
  ocupacion.service.ts       ← orquesta repo + periodo
  facturacion.service.ts     ← orquesta repo (agrupa en SQL)
  ausentismo.service.ts      ← orquesta repo + periodo
  reportes.routes.ts         ← auth, RBAC, parseo de query, mapeo snake_case
```

- `ReportesRepository` devuelve tipos de fila mínimos (`OcupacionRow`, `FacturacionRow`, `AusentismoRow`), nunca entidades de dominio completas.
- Los servicios no tocan `db`: reciben el repositorio ya construido, igual que `caja.service.ts`. Facilita tests puros de agregación y tests de integración con SQLite real.
- `reportes.routes.ts` mapea a `snake_case` igual que `bloqueos.routes.ts`/`caja.routes.ts`. La lógica de dominio no vive en la ruta.
- **Alternativa descartada — SQL directo en la ruta**: viola R8 y hace intestable la agregación.

### D9 — Validación de entrada

En `periodo.ts`, antes de tocar la base:

| Regla | Error |
|---|---|
| `desde` y `hasta` con formato `YYYY-MM-DD` y fecha real (no `2026-02-31`) | `400 validacion` |
| `desde <= hasta` | `400 validacion` |
| `diasEntre(desde, hasta) <= 366` | `400 validacion` |
| `granularidad ∈ {dia, semana, mes}` (default `dia` si se omite) | `400 validacion` |
| `medio` (facturación) ∈ los cinco valores del `CHECK` | `400 validacion` |
| `profesional_id`/`sillon_id` como identificador opaco válido (`1..64`, `[A-Za-z0-9_-]`) | `400 validacion` |

- El tope de 366 días cubre un año bisiesto completo de reportes mensuales y acota el costo de D2/D4. Es configurable solo si aparece evidencia de necesidad.
- `profesional_id` y `sillon_id` se validan como identificadores opacos: el esquema los declara `TEXT` sin forma UUID (migración 003) y los fixtures del proyecto usan ids legibles, por lo que exigir UUID rechazaría datos válidos del propio sistema. La regla real es forma segura: no vacío, 1..64 caracteres, sin espacios ni comillas.
- Se reutiliza el patrón de fecha de `caja.service` (`esFechaContableValida`), no se duplica la validación de zona.

### D10 — RBAC

En `shared/auth.ts`:

```ts
export const ROLES_REPORTES_OPERATIVOS: readonly Rol[] = ['recepcion', 'administracion'];
export const ROLES_REPORTES_FACTURACION: readonly Rol[] = ['administracion'];
export function puedeVerReportesOperativos(rol: Rol | undefined): boolean;
export function puedeVerReporteFacturacion(rol: Rol | undefined): boolean;
```

- `ocupacion` y `ausentismo` → `ROLES_REPORTES_OPERATIVOS`. Respetan `03-actores.md` ("recepción … ver reportes operativos").
- `facturacion` → `ROLES_REPORTES_FACTURACION`. Caja global es de administración (mismo criterio que `ROLES_CAJA_CIERRE`), y R4 prohíbe que recepción vea lo financiero global.
- `profesional` no entra por lista de roles: entra por **alcance**. Puede consultar `ocupacion`/`ausentismo` con el filtro forzado a su propio `usuario.profesional_id`.
- Si `profesional` envía un `profesional_id` distinto al propio → `403 forbidden` (no filtrado silencioso: un vacío sería indistinguible de "sin datos").
- Si `profesional` no tiene vínculo (`AuthContext.profesionalId` nulo) → `403 forbidden`.
- `requireAuth` ya resuelve `AuthContext.profesionalId` desde la BD en cada request; la ruta lo lee con `getAuth(res)` y no vuelve a consultar el vínculo.
- `facturacion` para `profesional` → `403` siempre.
- Sin token → `401` (lo resuelve el middleware existente).

### D11 — Sin índices nuevos

Los índices actuales cubren el acceso: `idx_mov_caja_aplicado_en` para facturación, y `idx_turno_prof_intervalo`/`idx_turno_sillon_intervalo` para los desgloses. El filtro por `inicio` sin dimensión no tiene índice propio, pero el filtro grueso de D4 y el tope de 366 días lo hacen irrelevante en el volumen objetivo.

- **Alternativa descartada — `CREATE INDEX idx_turno_inicio ON turno(inicio)`**: es una migración y este change es read-only. Queda como follow-up si aparece evidencia de degradación.

### D12 — Errores y ausencia de PHI

- Nuevo `ReportesError extends AppError` en `shared/errors.ts`, con `status: 400 | 403`, `code: 'validacion' | 'forbidden'` y `detalle?` solo en validación. `error-handler.ts` ya lo serializa.
- Los logs del módulo usan únicamente rango, granularidad y rol. Nunca ids de paciente ni montos por paciente (R3).
- Los query params se validan por forma antes de usarse en SQL; los valores viajan siempre como parámetros vinculados, nunca interpolados.

### D13 — Estrategia de tests (R11/R12)

SQLite real en memoria (`openDatabase(':memory:')`), fixtures ficticios (R1/R12), sin mockear transacción, nombres `Dado/Cuando/Entonces`.

- `reportes_periodo.test.ts` — unidad pura: validación de fechas, ISO week (incluye semana 53 y cambio de año), `diasEntre`, claves por granularidad.
- `reportes_ocupacion.test.ts` — agregación y bordes: estados que ocupan vs no, `deleted_at`, duración exacta, cambio de día local por zona.
- `reportes_facturacion.test.ts` — neteo de anulaciones, desglose por medio, separación obra social, corte por `aplicado_en` y no por `fecha_contable`.
- `reportes_ausentismo.test.ts` — denominador de resueltos, tasa con redondeo half-up, denominador cero → `null`.
- `reportes_routes.test.ts` — `supertest` sobre `createApp`: contratos JSON, `400`, `401`, `403`, y ausencia de PHI en cuerpos de error.

## Risks / Trade-offs

- **Ocupación sin denominador puede leerse como "ocupación" cuando en rigor es "horas turnadas"** → el nombre del campo (`minutos_ocupados`) y la ausencia de `pct` evitan la ambigüedad; queda documentado en el spec.
- **Ausentismo ignora cancelaciones** → una clínica con muchas cancelaciones anticipadas verá una tasa baja. Es la consecuencia aceptada de no migrar; se registra como limitación y posible follow-up.
- **Facturación por `aplicado_en` difiere de la producción del día del servicio** → es deliberado para conciliar con `cierre_caja`; quien necesite lo devengado espera C-15.
- **Agregación en memoria para ocupación/ausentismo** → acotada por el tope de 366 días y el volumen MVP; si el volumen crece, se evalúa índice por `inicio` o materialización.
- **Semana ISO puede cruzar meses/años** → un reporte mensual y uno semanal no suman igual. Se documenta; no es un bug.
- **`series` sin relleno de ceros** → un gráfico puede mostrar huecos. Se prefiere no inventar datos; el consumidor decide.

## UI Mockups

- **Decision**: no (no UI)
- **Rationale**: change estrictamente backend (endpoints JSON read-only). No agrega pantallas, componentes, estilos ni interacciones, por lo que no aplica el gate de `design-system` ni el de mockups por change.

## Migration Plan

- Sin migración de esquema, sin backfill, sin cambios de datos.
- Despliegue: código nuevo + montaje del router. Los endpoints existentes no cambian.
- Rollback: revertir el change; no queda estado persistido que limpiar.

## Open Questions

- ¿El dueño espera `series` con días en cero para graficar continuo, o alcanza con claves dispersas? Hoy se eligen claves dispersas por disciplina de datos.
- ¿"Ocupación" debería llamarse "horas turnadas" en la UI futura para no prometer un porcentaje que no existe?
- ¿El ausentismo necesitará incorporar cancelaciones tardías cuando exista el dato? Queda atado a un change que persista el instante de cancelación.
