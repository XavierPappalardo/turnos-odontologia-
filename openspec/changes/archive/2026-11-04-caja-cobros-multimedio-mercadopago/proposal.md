# Proposal

## Why

El change C-10 (`presupuestos-planes-tratamiento`, archivado 2026-11-02) dejó presupuestos aceptados con `saldo_centavos` pendiente de cobro, pero no existe aún el módulo de caja que materialice esos cobros: el modelo `pago` creado por C-02 (migración 004) es solo la estructura mínima y hoy solo se usa como suma por turno (`totalCobradoPorTurno`). RN-09 exige cierre de caja diario con trazabilidad y una única vez por día por caja, y FL-04 (CU-6) exige registrar medio de pago, saldo a cobrar y deudas impagas. Sin C-11, el flujo clínico→financiero queda abierto: no hay movimientos consultables, no hay cierre diario, no hay deudas ni estructura de Mercado Pago.

## What Changes

- **Extensión de `Pago`**: medios existentes (`efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`) y estados (`pendiente` → `cobrado` / `anulado`) con validaciones de servicio: importe > 0 en centavos, sin float, anulación consistente (solo `cobrado` puede anularse, con actor y motivo), trazabilidad de movimientos y control de doble registro por clave de idempotencia. La tabla `pago` (migración 004) se recompone dentro de la migración 010 con rebuild que preserva sus datos.
- **Caja diaria**: nueva tabla `movimiento_caja` (registro append-only por cada evento de pago/anulación, con `fecha_contable` y `aplicado_en` para asignaciones) y `cierre_caja` (cierre diario con snapshot histórico: resumen de ingresos por medio, total cobrado, anulaciones; único por día, solo rol autorizado — RN-09; los cierres no se modifican ni se reabren). La **fecha contable** del día se calcula con la zona horaria IANA configurada para la clínica (`CAJA_ZONA_HORARIA`, valor por defecto documentado — sin hardcodear UTC ni desplazamientos fijos; timestamps siempre en ISO-8601 UTC). Movimientos con fecha contable ya cerrada se **asignan de forma trazable** (actor, fecha y motivo `fecha_ya_cerrada`) a la siguiente caja abierta, sin alterar el snapshot del cierre anterior; si no existe caja abierta posterior, el cobro se rechaza sin persistir.
- **Gestión de deudas por concepto**: la deuda se define por **concepto con fuente de precio declarada**, no solo por presupuestos: cada cobro declara su **aplicación** — a un presupuesto `aceptado` vigente (con `turno_id` o `turno_id NULL`, C-10) o como cobro directo sobre un turno sin presupuestos `aceptado` (FL-04: entrada de caja pura trazada; no se inventan importes cuando no hay fuente de precio válida). Cuando un turno tiene presupuestos `aceptado`, el cobro debe declarar a qué presupuesto aplica (evita contabilizar el concepto dos veces). Pagos parciales con saldo restante tras cada cobro; tope por concepto (no se cobra más allá del saldo pendiente ni dos veces el mismo importe); deuda del paciente (medios ARS de bolsillo) diferenciada del dinero efectivamente cobrado a una obra social (medio `obra_social` ingresa a caja pero no reduce la deuda ARS del paciente; guard: no supera la cobertura restante del concepto — cobros OS vigentes computados, las anulaciones devuelven lo usado). Consultas de saldo por turno y deuda por paciente calculadas sobre movimientos válidos (excluye `anulado`), con historiales y anulados visibles. El modelo admite sumar futuras fuentes de precio (C-15 precios por prestación, C-12 liquidación OS) como conceptos adicionales sin reestructurar.
- **Mercado Pago (estructura, sin cobros reales)**: adaptador aislado de la lógica de caja, entorno de pruebas (`sandbox`) uniquemente, sin credenciales reales ni tokens en el repositorio, configuración vía variables de entorno documentadas en `backend/.env.example`; manejo de estados pendientes, errores y operación repetida, con confirmación en dos etapas — firma del webhook (`x-signature`/`x-request-id`/`data.id`) y consulta de verificación directa al proveedor (`GET /v1/payments/{id}` con Bearer del servidor) contrastando `external_reference`, importe, moneda y estado aprobado; cualquier falla deja el pago `pendiente` sin generar movimiento; no se inventan contratos de API (solo la documentación oficial de Mercado Pago referida en `design.md`).
- **Migración 010** (nueva): crea `movimiento_caja`, `cierre_caja` y recompone `pago` (rebuild dentro de la migración, datos preservados) con las columnas de soporte (`presupuesto_id` FK, `clave_idempotencia` UNIQUE, `referencia`, `actor_usuario_id`, `anulado_por_usuario_id`) y agrega en `movimiento_caja` la trazabilidad de asignación (`fecha_contable`, `aplicado_en`, `motivo_asignacion`), con CHECKs de integridad financiera e índices. No modifica ni renombra migraciones anteriores.
- **Endpoints**: registrar pago de turno (con medio), anular pago, consultar pagos/historial, consultar deuda por paciente y saldo por turno, cerrar caja del día, consultar resumen por medio e historial de cierres.
- **RBAC**: nueva matriz en `src/shared/auth.ts` para registrar cobros/consultar deudas (`ROLES_CAJA_GESTION` = recepción/administración) y para cerrar caja y confirmar pagos pendientes de Mercado Pago (`ROLES_CAJA_CIERRE` = solamente `administracion`) — R4: profesional no ve caja global.
- **Governance**: CHANGES.md declara `ALTO`, pero AGENTS.md R16 clasifica C-11 (`caja/cobros/multimedio`) como **CRITICAL**; se aplica el nivel de revisión más estricto (R16 prevalece) y la diferencia queda documentada en `design.md`.

## Capabilities

### New Capabilities
- `caja/pagos`: registro y ciclo de vida de pagos multimedio asociados a turno (estados, anulación con trazabilidad, idempotencia, pagos parciales) y cálculo de deudas/saldos válidos por turno y por paciente.
- `caja/cierre-diario`: cierre diario de caja con resumen de ingresos por medio, registro de anulaciones, trazabilidad, unicidad por día y control de rol autorizado (RN-09).
- `caja/mercadopago`: estructura de integración con Mercado Pago restringida a entorno de prueba (sandbox), sin credenciales reales, con estados pendientes, manejo de errores e idempotencia, preparada para incorporar credenciales reales más adelante.

### Modified Capabilities
(ninguna — las specs existentes no cambian requerimientos; `pago` ya definido en `core/models` se extiende vía repositorio y nuevas capabilities de `caja/*`)

## Impact

- **Código backend** (`backend/src`):
  - `shared/migrations.ts` — nueva constante `MIGRATION_010_CAJA` + entrada en el registro `MIGRATIONS` (sin tocar 001–009).
  - `core/pago.repository.ts` — extensión de `PagoRepository` (estados, idempotencia, anulaciones, historiales); sin reemplazar lo que funciona.
  - Nuevo módulo `src/caja/` — `cajaMovimiento.repository.ts`, `cierreCaja.repository.ts`, `caja.service.ts`, `caja.routes.ts`, `mercadopago/` (adaptador aislado).
  - `shared/auth.ts` — matrices `ROLES_CAJA_GESTION` / `ROLES_CAJA_CIERRE` (R4/RBAC).
  - `shared/config.ts` + `backend/.env.example` — variables opcionales de Mercado Pago (sandbox), documentadas, sin secretos.
  - `shared/types.ts` — brand ids y tipos de dominio de caja.
  - `shared/app.ts` — montaje del router de caja bajo `/api`.
- **Tests** (`backend/tests/*.test.ts`, Vitest, Dado/Cuando/Entonces, SQLite real en memoria, sin mockear transacciones — R12): cobros por medio, rechazo de importes negativos, parciales/saldo restante, deudas por paciente/turno, anulación, rechazo de duplicados, cierre diario único, cierre sin rol autorizado, trazabilidad, migración 010.
- **Sin cambios frontend** en este change (los endpoints quedan disponibles para UI posterior).
- **Sin dependencias nuevas** (R7): Node ≥ 22.5 + `node:sqlite`, Express 4, Vitest. Montos solo en `monto_centavos INTEGER` (R2/R5).
