# Design — C-09 historia-clinica-odontograma

## Context

Ver `proposal.md` para la motivación. Estado actual que condiciona el diseño:

- Migraciones 001→007 aplicadas por `runMigrations` (`backend/src/shared/migrations.ts`); cada migración corre dentro de `BEGIN IMMEDIATE`, por lo que una falla de 008 no deja esquema a medias. 006 y 007 ya están ocupadas por C-06 y C-07: C-09 es **008**.
- `usuario` (migración 002) no tiene vínculo con `profesional`; `usuario_rol` permite varios roles por usuario. `AuthContext` (`backend/src/auth/types.ts`) es `{ userId, tenantId, roles, email, jti }`.
- `BaseRepository<T>` exige `created_at`/`updated_at` en `insert` y asume `deleted_at` en `update`/`softDelete`: no sirve tal cual para tablas append-only.
- `turno` ya relaciona `paciente_id` + `profesional_id` y tiene `deleted_at`; es la única fuente para derivar "sus pacientes".
- `normalizarUtc` vive en `agenda/crearTurno.service.ts` y lanza `CrearTurnoError`; cinco módulos de agenda dependen de él.
- `SEGURIDAD`: SQLite guarda texto plano y no tiene `COMMENT ON COLUMN`; no hay cifrado en reposo, ni columna de tenant (el claim `tenant_id` es decorativo: el sistema es single-tenant de facto).
- No existen rutas de `paciente`: hoy los pacientes se crean por seed/fixtures. C-09 agrega solo `PATCH` sobre pacientes existentes.
- `knowledge-base/03-actores.md:44` declara "Dueño: Lectura" sobre HC/odontograma, en contradicción con la decisión de minimización de PHI.
- Governance **CRITICAL** (R16): el `apply` espera aprobación explícita del usuario antes de escribir código.

## Goals / Non-Goals

**Goals:**

- Modelar PHI con eventos inmutables y estado actual derivado, sin proyecciones ni `UPDATE` sobre historia clínica.
- Restringir lectura/escritura clínica al profesional tratante o a un delegado vigente, con `403` uniforme y auditado.
- Dejar un audit trail append-only, insertado en la misma transacción que la operación, sin PHI en el registro.
- Mantener R7/R8: sin dependencias nuevas, sin ORM, SQL solo en repositorios, tipos de dominio con brand types.
- Mantener la migración 008 aditiva y reversible por código (dejar las tablas nuevas sin uso).

**Non-Goals:**

- UI del odontograma o del historial; shell de frontend y design system.
- Exportación/impresión de HC, acceso del paciente a su propia HC (Ley 26.529, C-17), periodontograma.
- Cifrado en reposo, backup y consentimientos: riesgo aceptado y diferido (ver Risks).
- Aislamiento multi-tenant real: se documenta como supuesto, no se implementa.
- Presupuestos/planes (C-10) y cualquier consumo de la HC por reportes (C-14).

## Decisions

### D1. Eventos inmutables en lugar de estado mutable

```
hc_evento                odontograma_evento
  id                       id
  paciente_id              paciente_id
  turno_id?                turno_id?
  tipo                     pieza_fdi
  detalle                  superficie
  ocurrido_en              hallazgo
  actor_usuario_id         ocurrido_en
  profesional_id           actor_usuario_id
  enmienda_de?             profesional_id
  motivo_enmienda?         enmienda_de?
  created_at               motivo_enmienda?
                           created_at
```

`profesional_id` se persiste en el evento (además de `actor_usuario_id`) para que una reasignación posterior de `usuario.profesional_id` no reescriba quién atendió históricamente.

**Alternativas descartadas:** (a) `historia_clinica` + `entrada` con `UPDATE` — pierde historial y contradice `discovery.md:67`; (b) proyección `pieza_estado_actual` — optimización prematura para 1–10 profesionales y obliga a invalidar en cada enmienda.

### D2. Estado actual derivado por ventana, sin tabla de proyección

Estado del odontograma: último evento **no enmendado** por `(pieza_fdi, superficie)`.

```sql
SELECT pieza_fdi, superficie, hallazgo, id, ocurrido_en
FROM (
  SELECT e.*, ROW_NUMBER() OVER (
      PARTITION BY e.pieza_fdi, e.superficie
      ORDER BY e.ocurrido_en DESC, e.id DESC
    ) AS rn
  FROM odontograma_evento e
  WHERE e.paciente_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM odontograma_evento x WHERE x.enmienda_de = e.id
    )
) WHERE rn = 1
```

En HC, `es_vigente = NOT EXISTS (SELECT 1 FROM hc_evento x WHERE x.enmienda_de = e.id)`. Sin filas para una superficie = `sano` (modelo disperso).

### D3. Enmienda = evento nuevo que hereda el instante clínico

Una enmienda crea una fila nueva con `enmienda_de` y `motivo_enmienda` obligatorio; el original nunca se toca. El servidor **hereda `ocurrido_en` del evento original** e ignora el que envíe el cliente: una corrección de carga no debe reordenarse como si fuera evolución clínica.

```
E1 16-O caries   (10/01)
E2 16-O obturado (10/02)
E3 enmienda de E1 (cargada el 10/03, ocurrido_en heredado = 10/01)
=> estado 16-O = obturado (E2); E1 no vigente; E3 visible en historial
```

Un `UNIQUE INDEX` parcial sobre `enmienda_de` impide enmendar dos veces el mismo evento (`409`). Se permite enmendar una enmienda (cadena), aunque el caso esperado es enmendar el evento raíz.

**Alternativa descartada:** `anulado_por` en la fila original — requiere `UPDATE`, justo lo que el modelo prohíbe.

### D4. Autorización: vínculo derivado + delegación, resuelto por request

| Paso | Regla | Error |
|---|---|---|
| 1 | Bearer token válido | `401 no_autenticado` |
| 2 | Rol con acceso clínico (`profesional` únicamente) | `403 rol_no_autorizado` |
| 3 | `usuario.profesional_id` resuelto en DB (no en el JWT) | `403 sin_vinculo` |
| 4 | ¿Titular (≥1 turno) o delegación vigente? | `403 sin_vinculo` / `403 delegacion_vencida` |
| 5 | Existencia del paciente (solo si ya está autorizado) | `404` |

Consultas:

```sql
-- titular: cualquier estado, turnos no eliminados
SELECT 1 FROM turno
 WHERE paciente_id = ? AND profesional_id = ? AND deleted_at IS NULL LIMIT 1;

-- delegación vigente
SELECT 1 FROM delegacion_hc
 WHERE paciente_id = ? AND profesional_id = ?
   AND revocada_en IS NULL AND desde <= ? AND ? < hasta LIMIT 1;
```

Un paciente inexistente y uno ajeno producen el mismo `403` (sin enumeración). Los `403` se auditan, así que el sondeo queda registrado.

`AuthContext` gana `profesionalId?: ProfesionalId`, calculado en `requireAuth`/guard por request. Desvincular a un profesional aplica en el request siguiente, sin esperar el TTL del token.

### D5. Matriz de permisos

| Recurso | `recepcion` | `profesional` titular | delegado vigente | `administracion` |
|---|---|---|---|---|
| Leer HC / odontograma | 403 | 200 | 200 | 403 |
| Escribir HC / odontograma | 403 | 201 | 201 | 403 |
| Otorgar delegación | 403 | 201 (solo sus pacientes) | 403 | 201 |
| Revocar delegación | 403 | 204 (solo sus pacientes) | 204 (la propia) | 204 |
| `PATCH` `fecha_nacimiento` | 200 | 403 | 403 | 200 |
| `PATCH` `alergias` | 403 | 200 | 200 | 403 |

### D6. Migración 008 (aditiva)

```sql
ALTER TABLE paciente ADD COLUMN fecha_nacimiento TEXT;
ALTER TABLE paciente ADD COLUMN alergias TEXT;
ALTER TABLE usuario ADD COLUMN profesional_id TEXT REFERENCES profesional(id);
CREATE UNIQUE INDEX idx_usuario_profesional
  ON usuario(profesional_id) WHERE profesional_id IS NOT NULL;

CREATE TABLE hc_evento (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  turno_id TEXT REFERENCES turno(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('consulta','nota','diagnostico','procedimiento')),
  detalle TEXT NOT NULL CHECK (length(detalle) BETWEEN 1 AND 5000),
  ocurrido_en TEXT NOT NULL,
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  enmienda_de TEXT REFERENCES hc_evento(id),
  motivo_enmienda TEXT,
  created_at TEXT NOT NULL,
  CHECK ((enmienda_de IS NULL AND motivo_enmienda IS NULL)
      OR (enmienda_de IS NOT NULL AND length(trim(motivo_enmienda)) > 0)),
  CHECK (enmienda_de IS NULL OR enmienda_de <> id)
);
CREATE UNIQUE INDEX idx_hc_evento_enmienda
  ON hc_evento(enmienda_de) WHERE enmienda_de IS NOT NULL;
CREATE INDEX idx_hc_evento_paciente ON hc_evento(paciente_id, ocurrido_en, id);
CREATE INDEX idx_hc_evento_turno ON hc_evento(turno_id);

CREATE TABLE odontograma_evento (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  turno_id TEXT REFERENCES turno(id),
  pieza_fdi INTEGER NOT NULL CHECK (
    pieza_fdi % 10 BETWEEN 1 AND 8
    AND (pieza_fdi BETWEEN 11 AND 48 OR pieza_fdi BETWEEN 51 AND 85)
  ),
  superficie TEXT NOT NULL CHECK (superficie IN ('M','D','V','L','O','I')),
  hallazgo TEXT NOT NULL CHECK (hallazgo IN (
    'sano','caries','obturado','ausente','corona','endodoncia',
    'implante','extraccion_indicada','sellante','fractura'
  )),
  ocurrido_en TEXT NOT NULL,
  actor_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  enmienda_de TEXT REFERENCES odontograma_evento(id),
  motivo_enmienda TEXT,
  created_at TEXT NOT NULL,
  CHECK ((enmienda_de IS NULL AND motivo_enmienda IS NULL)
      OR (enmienda_de IS NOT NULL AND length(trim(motivo_enmienda)) > 0)),
  CHECK (enmienda_de IS NULL OR enmienda_de <> id)
);
CREATE UNIQUE INDEX idx_odontograma_evento_enmienda
  ON odontograma_evento(enmienda_de) WHERE enmienda_de IS NOT NULL;
CREATE INDEX idx_odontograma_paciente
  ON odontograma_evento(paciente_id, pieza_fdi, superficie, ocurrido_en, id);

CREATE TABLE delegacion_hc (
  id TEXT PRIMARY KEY,
  paciente_id TEXT NOT NULL REFERENCES paciente(id),
  profesional_id TEXT NOT NULL REFERENCES profesional(id),
  otorgada_por_usuario_id TEXT NOT NULL REFERENCES usuario(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) > 0),
  revocada_en TEXT,
  created_at TEXT NOT NULL,
  CHECK (hasta > desde)
);
CREATE INDEX idx_delegacion_hc_lookup
  ON delegacion_hc(paciente_id, profesional_id, hasta);

CREATE TABLE auditoria_phi (
  id TEXT PRIMARY KEY,
  ocurrido_en TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuario(id),
  rol TEXT NOT NULL CHECK (rol IN ('recepcion','profesional','administracion')),
  paciente_id TEXT,
  recurso TEXT NOT NULL CHECK (recurso IN (
    'historia_clinica','odontograma','delegacion_hc','paciente'
  )),
  recurso_id TEXT,
  accion TEXT NOT NULL CHECK (accion IN ('leer','crear','editar','exportar','imprimir')),
  resultado TEXT NOT NULL CHECK (resultado IN ('permitido','denegado')),
  motivo TEXT CHECK (motivo IS NULL OR motivo IN (
    'sin_vinculo','rol_no_autorizado','delegacion_vencida'
  )),
  ip TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auditoria_phi_paciente ON auditoria_phi(paciente_id, ocurrido_en);
CREATE INDEX idx_auditoria_phi_usuario ON auditoria_phi(usuario_id, ocurrido_en);
```

`auditoria_phi.paciente_id` **no** lleva FK: un intento denegado puede referir a un paciente inexistente y el log de seguridad no debe fallar por eso. `usuario_id` sí lleva FK (el actor siempre existe para un request autenticado).

Triggers insert-only (mismo patrón para las tres tablas de eventos):

```sql
CREATE TRIGGER hc_evento_no_update BEFORE UPDATE ON hc_evento
BEGIN SELECT RAISE(ABORT, 'hc_evento es insert-only'); END;
CREATE TRIGGER hc_evento_no_delete BEFORE DELETE ON hc_evento
BEGIN SELECT RAISE(ABORT, 'hc_evento es insert-only'); END;
```

### D7. Pieza → superficie: función pura, no CHECK

| Grupo | Piezas | `I` | `O` |
|---|---|---|---|
| Incisivos y caninos permanentes | 11–13, 21–23, 31–33, 41–43 | sí | no |
| Premolares permanentes | 14, 15, 24, 25, 34, 35, 44, 45 | no | sí |
| Molares permanentes | 16–18, 26–28, 36–38, 46–48 | no | sí |
| Incisivos y caninos temporales | 51–53, 61–63, 71–73, 81–83 | sí | no |
| Molares temporales | 54, 55, 64, 65, 74, 75, 84, 85 | no | sí |
| Todas | `M`, `D`, `V`, `L` | sí | sí |

`backend/src/clinica/fdi.ts` expone `esPiezaFdiValida`, `esSuperficieValida` y `esCombinacionValida(pieza, superficie)`; el servicio valida antes de insertar y responde `400`. No se puede expresar como CHECK sin duplicar 52 filas de lógica en SQL, y R11 pide tests Dado/Cuando/Entonces.

No se valida edad contra dentición: un paciente puede conservar temporales o tener permanentes a edades atípicas; inferirlo desde `fecha_nacimiento` produce falsos rechazos clínicos.

### D8. Fechas normalizadas a UTC

`ocurrido_en`, `desde`, `hasta` y `revocada_en` se persisten como ISO 8601 UTC de ancho fijo, para que la comparación lexicográfica y el `ORDER BY` sean correctos. Se extrae el núcleo puro de `normalizarUtc` a `backend/src/shared/fechas.ts` (`normalizarIsoUtc(valor): string | undefined`); `normalizarUtc` de agenda lo reutiliza conservando `CrearTurnoError`, y `clinica` lanza su propio error de validación. Sin cambio de comportamiento en agenda.

### D9. Repositorios append-only

`AppendOnlyRepository<T> extends BaseRepository<T>` en `backend/src/shared/repository.ts`:

- `insert` propio: usa solo `created_at` (las tablas de eventos no tienen `updated_at`) y valida identificadores de columna.
- `update` y `softDelete`: `override` que lanza un error de dominio (`evento_inmutable`).
- Se conservan `findById`/`countAll` para R8.

Tres capas de defensa: no hay endpoint de edición, el repositorio lo prohíbe y el trigger de SQLite aborta cualquier SQL que las esquive. `auditoria_phi` usa el mismo repositorio.

**Alternativa descartada:** agregar `updated_at`/`deleted_at` falsos a las tablas de eventos para reutilizar `BaseRepository` tal cual — columnas que invitan a usarse mal y contradicen el contrato.

### D10. API interna (sin UI)

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/pacientes/:id/historia-clinica?turno_id=` | `200 { paciente_id, eventos: [...] }` |
| `POST` | `/api/pacientes/:id/historia-clinica/eventos` | `201 { evento }` |
| `POST` | `/api/pacientes/:id/historia-clinica/eventos/:eventoId/enmiendas` | `201 { evento }` |
| `GET` | `/api/pacientes/:id/odontograma` | `200 { paciente_id, superficies: [{pieza, superficie, hallazgo, evento_id, ocurrido_en}] }` |
| `GET` | `/api/pacientes/:id/odontograma/historial?pieza=` | `200 { pieza, eventos: [...] }` |
| `POST` | `/api/pacientes/:id/odontograma/eventos` | `201 { evento }` |
| `POST` | `/api/pacientes/:id/odontograma/eventos/:eventoId/enmiendas` | `201 { evento }` |
| `POST` | `/api/pacientes/:id/delegaciones-hc` | `201 { delegacion }` |
| `DELETE` | `/api/pacientes/:id/delegaciones-hc/:delegacionId` | `204` |
| `PATCH` | `/api/pacientes/:id` | `200 { paciente }` |

Payloads de escritura (validación en servicio, mensajes sin PHI):

```json
// HC evento
{ "tipo": "consulta", "detalle": "...", "ocurrido_en": "2026-11-01T10:00:00-03:00", "turno_id": null }
// enmienda HC (ocurrido_en NO se acepta: se hereda)
{ "tipo": "consulta", "detalle": "...", "motivo_enmienda": "..." }
// odontograma evento
{ "pieza": 16, "superficie": "O", "hallazgo": "caries", "ocurrido_en": "...", "turno_id": null }
// enmienda odontograma (ocurrido_en NO se acepta: se hereda)
{ "pieza": 26, "superficie": "O", "hallazgo": "caries", "motivo_enmienda": "..." }
// delegación
{ "profesional_id": "...", "desde": "...", "hasta": "...", "motivo": "..." }
// paciente
{ "fecha_nacimiento": "1990-05-20" }  // o { "alergias": "Penicilina" }
```

`PATCH /api/pacientes/:id`: allowlist estricta por campo, rechazo `400` de cualquier campo desconocido (no se ignora en silencio), `YYYY-MM-DD` no futura para `fecha_nacimiento`, `alergias` ≤ 2000 caracteres y `""` normalizado a `NULL`.

Códigos de error nuevos en `shared/errors.ts`: `ValidacionClinicaError` (400, `eje: "clinica"`), `AccesoHcError` (403, `motivo`), `EnmiendaDuplicadaError` (409), `EventoNoEncontradoError` (404). Todos sin nombre de paciente, detalle clínico ni `ocurrido_en` en el mensaje.

### D11. Auditoría transaccional

Toda operación clínica corre en `BEGIN IMMEDIATE ... COMMIT` y escribe su fila de `auditoria_phi` dentro de la misma transacción, incluida la lectura:

```
BEGIN IMMEDIATE
  SELECT ... (HC / odontograma / delegación)
  INSERT INTO auditoria_phi (...)
COMMIT
```

- `accion`: `leer` para GET, `crear` para POST, `editar` para PATCH y revocación.
- `resultado`: `permitido` | `denegado`; `motivo` solo en denegados.
- `rol`: el rol que decidió la autorización (`profesional` en rutas clínicas; `recepcion`/`administracion` en denegaciones).
- `session_id`: el claim `jti` del access token. Es un identificador opaco por sesión, no un secreto ni parte de la firma.
- `ip`: `req.ip` de Express (sin `trust proxy` configurado; se documenta como valor de red directa).
- `recurso_id`: id del evento leído/creado cuando aplica; `NULL` en listados.

**Trade-off:** cada GET pasa a ser una transacción de escritura en SQLite. Para 1–10 profesionales y lecturas puntuales es aceptable; si el volumen crece, la salida es una cola de auditoría, no relajar la atomicidad. La alternativa best-effort se descarta porque pierde justo la evidencia que se quiere conservar.

Actualizar `alergias` también se audita (`recurso = "paciente"`, `accion = "editar"`): es dato clínico. El alta/revocación de delegaciones se audita con `recurso = "delegacion_hc"`.

### D12. Corrección de la KB

`knowledge-base/03-actores.md`:

- Fila 44 (`HC / odontograma`): Dueño pasa de `Lectura` a `No accede`; Odontólogo pasa a `Sus pacientes (o delegación vigente)`; Recepción queda `No accede`.
- Se agrega una nota de una línea bajo la matriz: la delegación temporal es un acto administrativo auditado y no otorga acceso de lectura a recepción ni a administración.

### D13. Supuestos explícitos

- **Single-tenant:** el claim `tenant_id` no aísla datos; todas las tablas siguen sin columna de tenant.
- **Un usuario ↔ un profesional:** `usuario.profesional_id` es UNIQUE; un profesional con dos cuentas no está soportado.
- **"Sus pacientes" incluye turnos cancelados/ausentes:** es una decisión de continuidad de atención, no de facturación.
- **El titular puede delegar solo sobre pacientes con turno propio:** no existe un "dueño clínico" del paciente más allá de la relación con turnos.

## Risks / Trade-offs

- **Cifrado en reposo diferido (decisión del usuario)** → riesgo aceptado y documentado: la base SQLite persiste PHI y texto clínico en claro. Mitigaciones actuales: PHI fuera de logs/errores (R3), acceso por request auditado, backups bajo control de infraestructura. Ninguna de las tres sustituye cifrado; queda como deuda explícita para un change posterior.
- **Crecimiento sin límite de `auditoria_phi` y de los eventos** → aceptado; no se permite purga (insert-only). El volumen esperado para 1–10 profesionales es bajo. Retención/archivado queda para operaciones, no para este change.
- **Cada lectura clínica escribe** → contención de escritura en SQLite bajo carga concurrente. Mitigación: transacciones cortas y sin trabajo de red dentro de ellas. Si duele, cola de auditoría (cambio de diseño, no de spec).
- **Continuidad de atención** → resuelta con `delegacion_hc` con vencimiento. Si nadie otorga la delegación, la HC sigue inaccesible para terceros: es el comportamiento buscado.
- **Recepción puede crear un turno y habilitar acceso** → un usuario de recepción podría, en teoría, asignar un turno para que un profesional acceda a un paciente. Mitigación: la creación de turnos ya está auditada por C-04, y el acceso clínico queda registrado con actor, IP y sesión. Se acepta para el segmento 1–10.
- **Derivar el estado con `NOT EXISTS` por fila** → costo O(n²) potencial en pacientes con mucha historia. Con decenas de eventos por pieza es irrelevante; el índice `(paciente_id, pieza_fdi, superficie, ocurrido_en, id)` acota el escaneo. Medir antes de optimizar.
- **`id` como desempate** → los ids son opacos (no cronológicos); el desempate es estable pero arbitrario. Solo aplica a eventos con el mismo `ocurrido_en`; no afecta la corrección de enmiendas porque estas heredan el instante original.
- **La KB sigue siendo la fuente de verdad** → se corrige solo `03-actores.md`. `04-modelos-datos.md` y `05-reglas-negocio.md` no describen HC; si se agregan reglas clínicas, deben citar los specs de C-09.

## Migration Plan

1. **008 se aplica con el runner** (`runMigrations`) dentro de `BEGIN IMMEDIATE`; si algo falla, no queda migración parcial ni fila en `schema_migrations`.
2. El código nuevo solo lee/escribe objetos de 008. Un despliegue escalonado es seguro porque el código previo ignora las columnas y tablas nuevas.
3. **Rollback de código:** volver a la versión anterior es suficiente; las columnas nullable y las tablas nuevas quedan sin uso.
4. **Rollback de esquema (si se exige):** en ventana de mantenimiento, `DROP TRIGGER`/`DROP TABLE` de los cuatro objetos nuevos, `DROP INDEX idx_usuario_profesional` y `DELETE FROM schema_migrations WHERE id = '008'`. SQLite no elimina columnas con `ALTER TABLE DROP COLUMN` en versiones viejas, por lo que `paciente.fecha_nacimiento`, `paciente.alergias` y `usuario.profesional_id` quedan; son nullable y no rompen la versión previa.
5. **Datos ficticios:** el seed agrega un usuario profesional vinculado y pacientes con `fecha_nacimiento`/`alergias` ficticias (R1/R12). Sin datos reales.
6. **Antes del apply:** aprobación explícita del usuario (governance CRITICAL, R16). `tasks.md` no se ejecuta solo.

## Open Questions

- Retención y archivado de `auditoria_phi`: no cambia specs ni tareas; se resuelve con operaciones cuando exista volumen real.
- Endpoints de exportación/impresión: el enum de `accion` ya los contempla, pero la API queda para C-14/portal.
- Política de backups cifrados: infraestructura, fuera del código de este change.
