# Design — C-07 recordatorios-automaticos

## Identificador
- Change: `C-07 recordatorios-automaticos`
- Fecha: 2026-11-01
- Estado: `diseñado` (pendiente de aprobación antes de tasks)

## 1. Modelo de datos: tabla `recordatorio` (migración 007)

Nueva tabla para programar y rastrear recordatorios automáticos. SQL idempotente (`IF NOT EXISTS`) siguiendo el patrón de migraciones previas:

```sql
CREATE TABLE IF NOT EXISTS recordatorio (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('recordatorio_48h', 'recordatorio_24h')),
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  programado_para TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'cancelado')),
  enviado_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordatorio_estado_fecha ON recordatorio(estado, programado_para);
CREATE INDEX IF NOT EXISTS idx_recordatorio_turno_tipo ON recordatorio(turno_id, tipo);
```

Razones:
- `turno_id` con FK a `turno` para integridad referencial (PRAGMA foreign_keys = ON ya está activo en el runner de migraciones).
- Índice compuesto `(estado, programado_para)` para que el worker encuentre rápido los recordatorios pendientes vencidos.
- Índice `(turno_id, tipo)` para evitar duplicados y para cancelar todos los recordatorios de un turno cuando cambia su estado.

## 2. Arquitectura del worker de recordatorios

### 2.1 Servicio (`backend/src/notificaciones/recordatorio.worker.ts`)

Interfaz de configuración inyectable:
```ts
export interface RecordatorioConfig {
  t48hHoras: number;      // default 48
  t24hHoras: number;      // default 24
  canalPredeterminado: 'whatsapp' | 'email'; // default 'whatsapp'
}
```

Función principal:
```ts
export function procesarRecordatoriosPendientes(db: DatabaseSync, config: RecordatorioConfig): Procesado[]
```

Flujo dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`):
1. Consultar recordatorios con `estado = 'pendiente'` y `programado_para <= ahora` usando el índice compuesto.
2. Para cada recordatorio:
   a. Marcar `enviado_en = ahora`, `estado = 'enviado'`, `updated_at = ahora`.
   b. Log sin PHI: `recordatorio enviado id=<recordatorio_id> turno=<turno_id> tipo=<tipo>`.
3. Devolver lista de recordatorios procesados con sus IDs y nuevos estados.

Nota: el envío real por WhatsApp API oficial queda fuera de este change (estructura solo). El worker marca como 'enviado' simulando el envío exitoso; en una fase posterior se conectará el envío real.

### 2.2 Función de creación de recordatorios

```ts
export function programarRecordatoriosParaTurno(
  db: DatabaseSync,
  turnoId: string,
  inicioTurno: string,     // ISO 8601 UTC
  config: RecordatorioConfig,
): void
```

Lógica:
1. Calcular `programado_para_48h = inicioTurno - t48hHoras` y `programado_para_24h = inicioTurno - t24hHoras`.
2. Solo crear recordatorios cuyo `programado_para` sea en el futuro (>= ahora). Si ya pasó, no se crea (el turno es demasiado pronto para ese recordatorio).
3. Verificar que no exista ya un recordatorio del mismo `turno_id` y `tipo` (índice único implícito vía consulta previa).
4. Insertar ambos recordatorios con `estado = 'pendiente'` dentro de `UnitOfWork.runInTransaction`.

## 3. Diseño de rutas públicas (`backend/src/notificaciones/recordatorio.routes.ts`)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `POST /api/public/recordatorios/procesar` | POST | Dispara `procesarRecordatoriosPendientes` manualmente (tests/demo) |
| `GET /api/public/recordatorios/pendientes` | GET | Lista recordatorios con estado 'pendiente' (estructura admin) |

- Rate limiting por IP (reuso de `PublicRateLimiter` de C-05, misma ventana/máximo que reservas).
- Sin JWT (estructura pública; en fase posterior se podría proteger con auth de C-03).
- Cuerpos de error sin PHI (solo ids opacos).

## 4. Integración con cambio de estado de turno (C-06)

Cuando un turno cambia de estado a `cancelado` o `ausente` (vía C-06 `turnoToken.service.ts` o `turnoEstado.service.ts`), se deben cancelar los recordatorios pendientes asociados:

```sql
UPDATE recordatorio SET estado = 'cancelado', updated_at = ahora
WHERE turno_id = ? AND estado = 'pendiente'
```

Esto se hace dentro de la misma transacción que el cambio de estado del turno para mantener atomicidad.

También cuando un turno se confirma (`reservado → confirmado`), los recordatorios programados siguen vigentes (el paciente aún va a venir); no se cancelan.

## 5. Configuración (`backend/src/shared/config.ts`)

Extender `AppConfig` con una nueva sección `recordatorio`:

```ts
export interface RecordatorioConfig {
  readonly t48hHoras: number;
  readonly t24hHoras: number;
  readonly canalPredeterminado: 'whatsapp' | 'email';
}
```

Variables de entorno con fallbacks:
- `RECORDATORIO_T48H_HORAS` (default `48`, ficticio [Supuesto FL-03])
- `RECORDATORIO_T24H_HORAS` (default `24`, ficticio [Supuesto FL-03])
- `RECORDATORIO_CANAL_PREDETERMINADO` (default `'whatsapp'`)

## 6. Montaje en app (`backend/src/shared/app.ts`)

Agregar tras las rutas de C-06:
```ts
app.use('/api/public', recordatorioRouter(db, config));
```

## 7. Diseño de tests (`backend/tests/recordatorio.test.ts`)

SQLite real en memoria (R12). Fixtures ficticios (R1/R12).

Escenarios Dado/Cuando/Entonces:
1. Dado turno confirmado Cuando programo recordatorios Entonces se crean 2 recordatorios pendientes (48h y 24h)
2. Dado recordatorios pendientes vencidos Cuando proceso Entonces se marcan como enviados
3. Dado recordatorio ya enviado Cuando proceso Entonces no se reprocesa (sigue como enviado)
4. Dado turno que cambia a cancelado Cuando se cambia el estado Entonces sus recordatorios pendientes se marcan como cancelados
5. Dado recordatorio con fecha futura Cuando proceso Entonces no se envía (todavía no llegó su hora)
6. Dado endpoint /procesar Cuando lo llamo Entonces ejecuta el worker y devuelve recordatorios procesados
7. Dado IP excede rate limit Cuando llamo a /procesar Entonces 429
8. Dado cuerpo sin PHI Cuando hay error Entonces respuesta solo tiene ids opacos

## 8. Decisiones de diseño

- **D1 (worker sincrónico, no cron)**: `procesarRecordatoriosPendientes` es una función invocable manualmente (endpoint /procesar) o desde un worker externo. No se implementa un cron interno en este change; queda para infraestructura de despliegue.
- **D2 (simulación de envío)**: El worker marca como 'enviado' sin llamar realmente a WhatsApp API (sin credenciales reales en este change). Estructura lista para conectar el envío real en fase posterior.
- **D3 (transacción por recordatorio)**: Cada recordatorio se procesa dentro de `UnitOfWork.runInTransaction` para prevenir race conditions si varios workers corren en paralelo (R9).
- **D4 (cancelación al cambiar estado)**: Los recordatorios pendientes se cancelan cuando el turno pasa a `cancelado` o `ausente`, ya que el paciente ya no viene.
- **D5 (no duplicados)**: Antes de crear recordatorios se verifica que no existan ya del mismo turno/tipo, usando el índice `(turno_id, tipo)`.
- **D6 (sin PHI en errores)**: Cuerpos de error solo con ids opacos (R3).

## 9. Riesgos abiertos
- Valores T-48h y T-24h (48h/24h ficticios): RN-10 / FL-03 los califican como valores configurables. Se dejan por env para ajustar sin redeploy.
- Envío real de WhatsApp requiere credenciales de Meta (API oficial) y costo por mensaje (RN-10). Queda fuera de este change.

---

¿Apruebo este diseño para proceder a **tasks**?

Responder: **Sí, continuar a tasks** / **No, ajustar design**.
