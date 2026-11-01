# Tasks — C-07 recordatorios-automaticos

## Identificador
- Change: `C-07 recordatorios-automaticos`
- Fecha: 2026-11-01
- Estado: `planificado` (pendiente de aprobación antes de implementar)

## Tareas de implementación (orden sugerido)

| # | Tarea | Archivos | Estado |
|---|-------|----------|--------|
| T-01 | Agregar migración 007: tabla `recordatorio` | `backend/src/shared/migrations.ts` | pendiente |
| T-02 | Agregar configuración de recordatorios en `config.ts` | `backend/src/shared/config.ts` | pendiente |
| T-03 | Crear servicio de recordatorios (`recordatorio.worker.ts`) | `backend/src/notificaciones/recordatorio.worker.ts` | pendiente |
| T-04 | Crear rutas públicas de recordatorios (`recordatorio.routes.ts`) | `backend/src/notificaciones/recordatorio.routes.ts` | pendiente |
| T-05 | Montar rutas públicas en `app.ts` | `backend/src/shared/app.ts` | pendiente |
| T-06 | Escribir tests Vitest Dado/Cuando/Entonces | `backend/tests/recordatorio.test.ts` | pendiente |
| T-07 | Ejecutar `tsc --noEmit` y `npm test` verdes | — | pendiente |
| T-08 | Cambiar checkbox C-07 a `[x]` en CHANGES.md | `CHANGES.md` | pendiente |

## Detalle por tarea

### T-01 — Migración 007 (`migrations.ts`)
- Añadir `MIGRATION_007_RECORDATORIO` con la tabla `recordatorio`:
  - `id TEXT PRIMARY KEY`
  - `turno_id TEXT NOT NULL REFERENCES turno(id)`
  - `tipo TEXT NOT NULL CHECK (tipo IN ('recordatorio_48h', 'recordatorio_24h'))`
  - `canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email'))`
  - `programado_para TEXT NOT NULL`
  - `estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'cancelado'))`
  - `enviado_en TEXT` (nullable)
  - `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`
- Índices: `idx_recordatorio_estado_fecha(estado, programado_para)`, `idx_recordatorio_turno_tipo(turno_id, tipo)`
- Agregar `{ id: '007', sql: MIGRATION_007_RECORDATORIO }` al array `MIGRATIONS` (orden ascendente, después de 006).
- Seguir patrón de idempotencia (`IF NOT EXISTS`) de migraciones previas.

### T-02 — Configuración (`config.ts`)
- Nueva interfaz `RecordatorioConfig`:
  - `t48hHoras: number` — leído de `RECORDATORIO_T48H_HORAS` (default `48`)
  - `t24hHoras: number` — leído de `RECORDATORIO_T24H_HORAS` (default `24`)
  - `canalPredeterminado: 'whatsapp' | 'email'` — leído de `RECORDATORIO_CANAL_PREDETERMINADO` (default `'whatsapp'`)
- Agregar `recordatorio: RecordatorioConfig` a `AppConfig`.
- Usar `positiveInt` para validación de valores numéricos (patrón existente).
- No hardcodear secretos; solo valores numéricos de configuración.

### T-03 — Servicio (`recordatorio.worker.ts`)
- Directorio `backend/src/notificaciones/` (nuevo, siguiendo arquitectura KB-08 §2.4).
- Interfaz `RecordatorioConfig` exportada (o importada de config).
- Función `programarRecordatoriosParaTurno(db, turnoId, inicioTurno, config)`:
  1. Calcular `programado_para_48h = inicioTurno - t48hHoras` y `programado_para_24h = inicioTurno - t24hHoras`.
  2. Solo crear si `programado_para >= ahora` (en el futuro).
  3. Verificar que no exista ya recordatorio del mismo `turno_id` y `tipo`.
  4. Insertar dentro de `UnitOfWork.runInTransaction`.
- Función `procesarRecordatoriosPendientes(db, config)`:
  1. Consultar `estado = 'pendiente'` y `programado_para <= ahora` (índice compuesto).
  2. Para cada uno, dentro de transacción: marcar `enviado_en = ahora`, `estado = 'enviado'`, `updated_at = ahora`.
  3. Log sin PHI: `recordatorio enviado id=<recordatorio_id> turno=<turno_id> tipo=<tipo>`.
  4. Devolver lista de procesados.
- Función `cancelarRecordatoriosDeTurno(db, turnoId)`:
  - `UPDATE recordatorio SET estado = 'cancelado', updated_at = ahora WHERE turno_id = ? AND estado = 'pendiente'`.
  - Llamar desde `turnoToken.service.ts` y `turnoEstado.service.ts` cuando el turno cambia a `cancelado` o `ausente`.

### T-04 — Rutas (`recordatorio.routes.ts`)
- Router Express sin `requireAuth` ni `requireRoles`.
- `POST /recordatorios/procesar`: llamar `procesarRecordatoriosPendientes`, responder `200` con lista de procesados.
- `GET /recordatorios/pendientes`: consultar `estado = 'pendiente'`, responder `200` con lista.
- Middleware de rate limiting público (reuso de `publicRateLimiterMiddleware` de C-05).
- Capturar errores y llamar `next(err)`.
- Cuerpos de error sin PHI.

### T-05 — Montaje (`app.ts`)
- Importar `recordatorioRouter`.
- `app.use('/api/public', recordatorioRouter(db, config));` tras las rutas de C-06.
- Integración de `cancelarRecordatoriosDeTurno` en `turnoToken.service.ts` (al cancelar/reprogramar) y `turnoEstado.service.ts` (al cambiar estado a cancelado/ausente).

### T-06 — Tests (`recordatorio.test.ts`)
- SQLite real en memoria (`openDatabase(':memory:')`), sin mock de transacción (R12).
- Fixtures ficticios: 1 profesional, 1 sillón, 1 paciente, 1 turno confirmado/presente.
- Crear recordatorios insertando directamente en `recordatorio` para tests de procesamiento.
- Escenarios (ver design §7):
  1. Programar recordatorios para turno confirmado → se crean 2 pendientes (48h y 24h)
  2. Procesar recordatorios vencidos → se marcan como enviados
  3. Recordatorio ya enviado → no se reprocesa
  4. Turno cambia a cancelado → recordatorios pendientes se marcan como cancelados
  5. Recordatorio con fecha futura → no se procesa todavía
  6. Endpoint `/procesar` → ejecuta worker y devuelve procesados
  7. IP excede rate limit → 429
  8. Error sin PHI → cuerpo solo ids opacos
- Formato Dado/Cuando/Entonces en cada `it()`.

### T-07 — Verificación
- `npx tsc --noEmit` (TypeScript estricto, sin `any` sin justificar — R10).
- `npm test` (Vitest) verde (todos los tests, incluidos preexistentes).
- R1: sin datos reales en fixtures/seed.
- R2: montos en centavos enteros (N/A para C-07).
- R3: sin PHI en logs/errores.

### T-08 — CHANGES.md
- Cambiar `[ ]` por `[x]` en C-07 dentro de `CHANGES.md` (FASE 2).

---

## Criterios de definición de "done"
- [ ] T-01 a T-06 completas y verificadas.
- [ ] T-07: `tsc --noEmit` + `npm test` verdes.
- [ ] T-08: checkbox C-07 marcado en CHANGES.md.
- [ ] Estado del change: listo para archivar (`/opsx:archive`).

---

¿Apruebo estas tasks para proceder a la **implementación** (apply)?

Responder: **Sí, continuar a implementar (apply)** / **No, ajustar tasks**.
