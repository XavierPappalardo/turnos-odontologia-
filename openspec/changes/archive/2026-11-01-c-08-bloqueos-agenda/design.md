# Design — C-08 bloqueos-agenda

## Context

Ver `proposal.md` para la motivación. Estado actual que condiciona el diseño:

- `backend/src/agenda/bloqueo.repository.ts` expone solo `existeBloqueoAplicable` (lectura) y su `BloqueoRow` no declara `deleted_at`, aunque la columna existe desde la migración 004.
- `BaseRepository<T>` (`backend/src/shared/repository.ts`) solo tiene `insert`, `insertOrIgnore`, `findById` y `countAll`; no hay `update` ni `softDelete` genéricos.
- `TurnoRepository` tiene tres consultas de agenda (`existeSolapeProfesional`, `existeSolapeSillon`, `contarActivosEnHueco`) que no filtran `deleted_at`.
- `crearTurno.service.ts` ya centraliza `normalizarUtc` (ISO 8601 con zona explícita) y `exigirFk` (profesional/sillón requieren `activo = 1`); `reservaOnline.service.ts` reutiliza `normalizarUtc`.
- `error-handler.ts` traduce cualquier `AppError` a su `status` + `toBody()`, sin stack ni PHI.
- `AuthContext` no vincula usuario con profesional: no existe columna `usuario.profesional_id` ni tabla puente.
- Tabla `bloqueo` (003) + `deleted_at` (004) + índice `idx_bloqueo_aplicabilidad(profesional_id, sillon_id, inicio, fin)` ya cubren el modelo: no hace falta migración.

Restricciones duras aplicables: R8 (SQL solo en repositorios), R9 (`BEGIN IMMEDIATE` en escrituras que validan intersección), R10 (TS estricto, brand types, sin `any`), R3 (sin PHI en errores/logs), R11 (escenarios Vitest Dado/Cuando/Entonces).

## Goals / Non-Goals

**Goals:**

- CRUD interno de bloqueos con soft-delete y filtros de listado.
- Rechazo atómico de bloqueos que intersectan turnos activos, devolviendo los `turno_id` en conflicto.
- Que `deleted_at` gobierne la aplicabilidad en las cuatro consultas de agenda, de forma consistente.
- Extender `BaseRepository` con primitivas reutilizables (`update`, `softDelete`) sin abrir SQL fuera de repositorios.

**Non-Goals:**

- UI de agenda, bloqueos recurrentes/periódicos o carga masiva.
- Vincular `usuario` con `profesional` (requiere migración; ver Open Questions).
- Notificar pacientes o cancelar turnos al crear un bloqueo.
- Cambiar la máquina de estados del turno, `ROLES_CREAR_TURNO` o el flujo de `crearTurno`.
- Borrado físico de bloqueos.

## Decisions

### D1 — `BaseRepository.update` y `BaseRepository.softDelete` genéricos

```ts
update(
  id: string,
  patch: Partial<Omit<T, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>>,
): boolean;
softDelete(id: string): boolean;
```

- `update` arma `SET` dinámico con las claves del patch + `updated_at = ?`, aplica `WHERE id = ? AND deleted_at IS NULL` y devuelve `changes === 1`.
- `softDelete` ejecuta `UPDATE <tabla> SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL` y devuelve `changes === 1`; así un segundo delete no reescribe el sello.
- Los nombres de columna se validan contra `/^[a-z][a-z0-9_]*$/` antes de interpolar: el patch viene de código tipado, no del request, pero la validación cierra la puerta a inyección por identificador.
- **Alternativas descartadas**: SQL de update/delete duplicado en cada repositorio (viola DRY y multiplica superficie R8); ORM (R7 lo prohíbe).

### D2 — `BloqueoRepository` como dueño del SQL de bloqueos

`BloqueoRow` incorpora `deleted_at: string | null`. Superficie nueva:

```ts
crear(input: NuevoBloqueo): void;
actualizar(id: BloqueoId, patch: BloqueoEditable): boolean;
bajaLogica(id: BloqueoId): boolean;
buscarVigente(id: BloqueoId): BloqueoRow | undefined; // deleted_at IS NULL
listar(filtros: FiltroBloqueos): BloqueoRow[];        // deleted_at IS NULL + filtros
turnosActivosEnInterseccion(
  profesionalId: string | null,
  sillonId: string | null,
  inicio: string,
  fin: string,
): TurnoId[];
```

`turnosActivosEnInterseccion` traduce la globabilidad a SQL:

```sql
SELECT id FROM turno
 WHERE estado IN ('reservado', 'confirmado', 'presente')
   AND deleted_at IS NULL
   AND inicio < ?   -- bloqueo.fin
   AND fin > ?      -- bloqueo.inicio
   AND (? IS NULL OR profesional_id = ?)   -- bloqueo.profesional_id
   AND (? IS NULL OR sillon_id = ?)        -- bloqueo.sillon_id
 ORDER BY inicio
```

- Devuelve solo `TurnoId` (ids opacos), nunca datos del paciente (R3).
- `listar` filtra por `profesional_id`, `sillon_id` (igualdad exacta; NULL no matchea globales salvo que se pida explícitamente sin filtro) y por intersección con `[desde, hasta)` usando `inicio < hasta AND fin > desde`.
- **Alternativa descartada**: resolver la intersección en el servicio con varias consultas; se rechaza porque el SQL debe vivir en el repositorio (R8) y una sola consulta evita ventanas de carrera dentro de la transacción.

### D3 — `deleted_at IS NULL` en toda la agenda

Se agrega el filtro a `existeBloqueoAplicable`, `existeSolapeProfesional`, `existeSolapeSillon` y `contarActivosEnHueco`. Hoy ningún flujo hace soft-delete de turnos, pero el filtro se aplica por consistencia con la columna creada en 004 y para que una futura baja de turno no ocupe agenda.

- `crearTurno.service.ts` no cambia de flujo: hereda el filtro vía repositorio (cumple la decisión 10 de alcance).
- `reservaOnline.service.ts` hereda el mismo beneficio sin cambios.
- Escenario explícito en `bloqueo_softdelete.test.ts`: bloqueo vigente rechaza, `DELETE` → `204`, el mismo turno ahora responde `201`.

### D4 — Validación, normalización y errores

- `normalizarUtc` se reutiliza importándolo desde `crearTurno.service.ts` (ya es el patrón de `reservaOnline.service.ts`); no se duplica la semántica ISO/UTC.
- FK: `profesional` y `sillon` deben existir con `activo = 1 AND deleted_at IS NULL` cuando el campo no es nulo; si no, `400`.
- Orden de validación en el servicio: campos obligatorios → `normalizarUtc` → `fin > inicio` → FK → RBAC (defensa en profundidad) → intersección con turnos activos → escritura.
- Nuevo error tipado en `backend/src/shared/errors.ts`:

```ts
export class BloqueoError extends AppError {
  declare readonly status: 400 | 403 | 404 | 409;
  declare readonly code: 'validacion' | 'forbidden' | 'not_found' | 'conflicto';
  readonly eje?: 'bloqueo';
  readonly turnoIds?: readonly TurnoId[];
  // toBody(): { error, eje?, turno_ids?, detalle? }
}
```

`turno_ids` es la lista de ids en conflicto; `detalle` solo aparece en `validacion`. El `error-handler` existente ya lo serializa sin cambios.
- `404` en `PUT`/`DELETE` cuando el `id` no existe o ya tiene `deleted_at`.
- **Alternativa descartada**: reutilizar `CrearTurnoError`; su contrato de `ids` no contempla listas de turnos y mezclaría semánticas de dos changes.

### D5 — Servicio `bloqueo.service.ts`

```ts
crearBloqueo(db, input: CrearBloqueoInput): BloqueoCreado;
listarBloqueos(db, input: ListarBloqueosInput): BloqueoRow[];
actualizarBloqueo(db, input: ActualizarBloqueoInput): BloqueoRow;
eliminarBloqueo(db, input: EliminarBloqueoInput): void;
```

- `crearBloqueo` y `actualizarBloqueo` corren completos dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`): la consulta de intersección y la escritura son atómicas frente a un `crearTurno` concurrente (R9). `eliminarBloqueo` también usa la UoW por consistencia de escritura.
- `actualizarBloqueo` lee el bloqueo vigente (404 si no está), valida los campos recibidos con las mismas reglas y solo entonces escribe; si la intersección falla, lanza `409` y la transacción hace `ROLLBACK` dejando el bloqueo intacto.
- `listarBloqueos` no escribe: consulta directa al repositorio. No hay lógica por rol en el servicio; el filtro por `recepcion`/`administracion` ocurre en la ruta.
- **Alternativa descartada**: validar intersección en la ruta; se rechaza porque la ruta no debe conocer reglas de dominio y perdería atomicidad.

### D6 — RBAC de bloqueos

En `backend/src/shared/auth.ts`:

```ts
export const ROLES_BLOQUEOS: readonly Rol[] = ['recepcion', 'administracion'];
export function puedeGestionarBloqueos(rol: Rol | undefined): boolean;
export function puedeLeerBloqueos(rol: Rol | undefined): boolean;
```

- Las cuatro rutas (`POST`, `GET`, `PUT`, `DELETE`) usan `requireRoles(...ROLES_BLOQUEOS)`; el `profesional` recibe `403` antes de tocar el servicio y el servicio de escritura vuelve a verificar (defensa en profundidad).
- `GET` no acepta acotamiento por query param: quien puede leer ve todos los bloqueos vigentes. Esto elimina la lectura auto-declarada que tenía el diseño anterior.
- `puedeLeerBloqueos` se mantiene como helper explícito para que el contrato de lectura sea testeable, pero devuelve el mismo conjunto de roles que `puedeGestionarBloqueos`.

### D7 — Rutas y montaje

`backend/src/agenda/bloqueos.routes.ts`, montado con `app.use('/api', bloqueosRouter(db, config))` en `shared/app.ts`:

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/api/bloqueos` | `201` con el bloqueo creado |
| `GET` | `/api/bloqueos?profesional_id=&sillon_id=&desde=&hasta=` | `200 { bloqueos: [...] }` |
| `PUT` | `/api/bloqueos/:id` | `200` con el bloqueo actualizado |
| `DELETE` | `/api/bloqueos/:id` | `204` sin cuerpo |

- Mapeo a snake_case (`profesional_id`, `sillon_id`, `inicio`, `fin`, `motivo`, `deleted_at`) solo en la ruta.
- Query params: solo strings; `desde`/`hasta` se normalizan con `normalizarUtc`; un parámetro inválido responde `400`.
- Sin PHI en cuerpos ni logs: los bloqueos no contienen datos de pacientes; el log operativo usa solo `bloqueo id=<uuid>` (R3).

### D8 — Sin migración

La tabla `bloqueo`, la columna `deleted_at` y el índice `idx_bloqueo_aplicabilidad` ya existen. Se consideró agregar un índice parcial `WHERE deleted_at IS NULL`, pero el índice actual sigue siendo usable por prefijo `(profesional_id, sillon_id, inicio, fin)` y el volumen MVP no lo justifica. Se consideró un `CHECK (profesional_id IS NOT NULL OR sillon_id IS NOT NULL)`, pero la decisión 7 permite ambos NULL (bloqueo global).

### D9 — Estrategia de tests (R11/R12)

SQLite real en memoria (`openDatabase(':memory:')`), fixtures ficticios (R1/R12), sin mockear la transacción. Nombres `Dado/Cuando/Entonces` en cada `it()`.

`backend/tests/bloqueos.test.ts`:

1. Recepción crea bloqueo por profesional → `201` y aparece en `GET`.
2. Bloqueo global (ambos NULL) rechaza turno de cualquier profesional/sillón → `409 eje=bloqueo`.
3. Bloqueo por sillón no afecta a otro sillón → turno `201`.
4. Alta de bloqueo que intersecta turno `confirmado` → `409` con `turno_ids` y sin persistir.
5. Turno `cancelado` en el rango no impide crear el bloqueo → `201`.
6. Edición que pisa turno activo → `409` y rango original intacto.
7. `PUT` con id inexistente → `404`; `DELETE` con id inexistente → `404`.
8. `fin <= inicio`, FK inexistente y fecha sin zona → `400`.
9. Profesional recibe `403` en `POST`, `GET`, `PUT` y `DELETE`; `recepcion` y `administracion` leen todos los bloqueos vigentes.
10. `GET` filtra por profesional y rango de fechas.

`backend/tests/bloqueo_softdelete.test.ts`:

1. `DELETE` marca `deleted_at` y responde `204` (la fila sigue existiendo).
2. Bloqueo borrado ya no aparece en `GET`.
3. Bloqueo borrado no bloquea `crearTurno` → `201`.
4. Segundo `DELETE` → `404` y `deleted_at` no cambia.
5. `contarActivosEnHueco` / `existeSolape*` ignoran turnos con `deleted_at` (inserción directa de un turno soft-deleted).

## Risks / Trade-offs

- **Carrera bloqueo↔turno** → ambas escrituras usan `BEGIN IMMEDIATE`; SQLite serializa al escritor y la segunda transacción ve el resultado de la primera.
- **Un bloqueo borrado "resucita" al hacer rollback de código** → el código anterior no filtra `deleted_at`; documentar que el rollback de este change requiere revisar bloqueos con `deleted_at` no nulo.
- **Lectura cerrada a `recepcion`/`administracion`** → el profesional no ve sus propios bloqueos. Es deliberado (R4/privacidad de configuración de agenda) y evita la lectura auto-declarada; si el producto pide visibilidad para el profesional, se habilita cuando exista vínculo `usuario ↔ profesional`.
- **`update` genérico** → validación de identificadores + uso desde repositorios concretos; no se expone a entrada de usuario.
- **Bloqueos solapados redundantes** → permitidos a propósito (no hay UNIQUE de rango); el costo es ruido operativo, no corrección.

## Migration Plan

- Sin migración de esquema ni backfill.
- Despliegue: código nuevo; los bloqueos existentes (con `deleted_at` NULL) siguen aplicando igual.
- Rollback: revertir el change. Antes de revertir, decidir qué hacer con bloqueos soft-deleted, porque el código anterior los tratará como vigentes.

## Open Questions

- ¿Los bloqueos deben ser visibles para el profesional? Hoy la lectura está cerrada a `recepcion`/`administracion`; abrirla de forma segura requiere el vínculo `usuario ↔ profesional` (columna/tabla nueva, change posterior), no un query param.
- ¿Los bloqueos deben soportar recurrencia (vacaciones por rango, feriados recurrentes)? Fuera del MVP de C-08; el modelo actual cubre rangos simples.
