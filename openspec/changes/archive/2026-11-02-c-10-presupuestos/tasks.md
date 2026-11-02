# Tasks

## 1. Migración 009 (capa de datos)

- [x] 1.1 Crear archivo de migración SQL `009` con tablas `presupuesto` y `item_presupuesto`, columnas de auditoría (`created_at`, `updated_at`, `deleted_at`), FKs a `paciente`/`turno`/`obra_social_plan`, y CHECKs de integridad financiera (`monto_centavos >= 0`, etc.). Verificación: archivo SQL existe y tiene ambas tablas con columnas esperadas.
- [x] 1.2 Ejecutar migración 009 en SQLite de prueba y verificar que las tablas existen con sus columnas, FKs y CHECKs. Verificación: escenario Vitest abre base con migraciones 001→009 y confirma existencia de `presupuesto` y `item_presupuesto`.

## 2. Brand types y modelos de dominio

- [x] 2.1 Definir brand types `PresupuestoId`, `ItemPresupuestoId`, `ObraSocialPlanId` (y reusar `PacienteId`, `TurnoId`). Verificación: `tsc --noEmit` pasa y los tipos son distintivos (no se confunden entre sí).
- [x] 2.2 Definir interfaces de dominio `Presupuesto` y `ItemPresupuesto` con `monto_centavos`/`total_centavos`/`cobertura_centavos`/`saldo_centavos` como `number` entero (centavos), nunca float. Verificación: `tsc --noEmit` pasa; ningún campo monetario es float.

## 3. Repositorios (BaseRepository[T] + UnitOfWork + AuditMixin)

- [x] 3.1 Implementar `PresupuestoRepository` extendiendo `BaseRepository[Presupuesto]`. Verificación: Vitest Dado/Cuando/Entonces prueba crear, consultar por id, listar, soft-delete.
- [x] 3.2 Implementar `ItemPresupuestoRepository` extendiendo `BaseRepository[ItemPresupuesto]`. Verificación: Vitest Dado/Cuando/Entonces prueba crear ítem, consultar por presupuesto, listar ítems.
- [x] 3.3 Verificar que repositories usan `UnitOfWork` con `AuditMixin` y nunca SQL suelto fuera de la capa de repositorios (R8). Verificación: inspección de código + tests pasan con SQLite real en memoria.

## 4. Servicio de presupuestos (reglas de negocio)

- [x] 4.1 Implementar creación de presupuesto con `turno_id` NULLABLE y estado inicial `borrador`. Verificación: Vitest Dado/Cuando/Entonces — presupuesto standalone se crea con `turno_id` NULL y estado `borrador`.
- [x] 4.2 Implementar autocalculo de `cobertura_centavos` y `saldo_centavos` desde `obra_social_plan.cobertura_pct` del paciente. Verificación: Vitest cubre plan con cobertura (cálculo correcto) y sin plan (cobertura 0, saldo = total).
- [x] 4.3 Implementar máquina de estados `borrador → enviado → aceptado | rechazado | vencido` con estados terminales. Verificación: Vitest cubre todas las transiciones válidas y rechaza inválidas (ej. borrador→aceptado, estado terminal sin transición).
- [x] 4.4 Implementar edición solo en estado `borrador` (rechazar en otros estados). Verificación: Vitest permite editar en borrador y rechaza en enviado/aceptado/rechazado/vencido.
- [x] 4.5 Implementar ítems de presupuesto con `monto_centavos` INTEGER, recálculo de `total_centavos`, y referencia opcional a `pieza_fdi`+`superficie` del odontograma. Verificación: Vitest cubre suma de ítems, recálculo al editar, y rechazo de monto negativo.

## 5. Rutas Express y autorización

- [x] 5.1 Implementar rutas `GET/POST/PATCH/DELETE /api/presupuestos` y `POST /api/presupuestos/:id/transicion`. Verificación: Vitest de integración llama cada ruta y verifica códigos de respuesta.
- [x] 5.2 Aplicar autorización clínica vía patrón `clinica/acceso-hc` (C-09) a ítems vinculados al odontograma: `profesional` con acceso vigente puede leer/escribir; `recepcion`/`administracion` reciben `403`. Verificación: Vitest cubre rol profesional autorizado (200) y recepción denegada (403).

## 6. Pruebas y verificación final

- [x] 6.1 Ejecutar `npx vitest run` y confirmar que todos los tests de C-10 están verdes. Verificación: salida de Vitest muestra 0 tests fallando.
- [x] 6.2 Ejecutar `tsc --noEmit` y confirmar cero errores de tipo. Verificación: TypeScript compila sin errores.

## Workflow follow-up

- Ejecutar `/opsx:apply` para implementar el cambio tras revisión de gobernanza MEDIUM (R16).
- Ejecutar `/opsx:archive` una vez cumplidos los requisitos de revisión y marcar el change como completo en CHANGES.md.
