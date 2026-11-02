# Proposal — C-09 historia-clinica-odontograma

## Why

El MVP incluye historia clínica + odontograma FDI (F-05, `knowledge-base/02-descripcion.md` #5), pero hoy el backend solo tiene agenda, auth y las entidades core: no existe ninguna tabla, endpoint ni permiso clínico. C-09 es además el primer change que persiste PHI, y su modelo es el más caro de revertir de todo el roadmap: sin eventos inmutables, alcance por profesional y audit trail, C-10 (presupuestos), C-14 (reportes) y cualquier pantalla futura heredarían un modelo clínico que no se puede auditar ni corregir sin perder historia.

## What Changes

- **Migración aditiva `008`** (006 y 007 ya están ocupadas por C-06 y C-07): `paciente.fecha_nacimiento` y `paciente.alergias` (ambas nullable); `usuario.profesional_id` (FK nullable a `profesional`, único); tablas `hc_evento`, `odontograma_evento`, `delegacion_hc` y `auditoria_phi`, con índices y triggers insert-only.
- **Historia clínica event-sourced**: cada registro es un evento inmutable (`consulta`, `nota`, `diagnostico`, `procedimiento`) con `ocurrido_en`, `actor_usuario_id`, `profesional_id` y `turno_id` opcional. Una corrección de carga se expresa como evento nuevo con `enmienda_de` + `motivo_enmienda`; el evento original nunca se actualiza ni se borra, y el estado clínico vigente excluye lógicamente los eventos enmendados (el historial completo sigue visible).
- **Odontograma event-sourced por pieza + superficie**: piezas FDI permanentes (11–48) y temporales (51–85); superficies `M`, `D`, `V`, `L`, `O`, `I`; catálogo exclusivo de 10 hallazgos (`sano`, `caries`, `obturado`, `ausente`, `corona`, `endodoncia`, `implante`, `extraccion_indicada`, `sellante`, `fractura`). Estado exclusivo por superficie: el último evento gana. Sin filas = sano (modelo disperso: no se persisten 260 casillas por paciente).
- **Validación pieza→superficie como regla de dominio pura**: `I` solo en incisivos/caninos, `O` solo en premolares/molares; combinaciones inválidas se rechazan con `400` antes de tocar la base (no se expresa como CHECK de SQLite).
- **API interna** (sin UI en este change): `GET/POST /api/pacientes/:id/historia-clinica(/eventos)`, `POST /api/pacientes/:id/historia-clinica/eventos/:eventoId/enmiendas`, `GET/POST /api/pacientes/:id/odontograma(/eventos)`, `POST /api/pacientes/:id/delegaciones-hc`, `DELETE /api/pacientes/:id/delegaciones-hc/:delegacionId` y `PATCH /api/pacientes/:id` (allowlist por campo y rol).
- **Alcance de acceso por profesional**: un paciente es "suyo" si tiene al menos un turno con ese profesional en cualquier estado. Recepción recibe `403` en HC y odontograma; administración/dueño no lee HC ni odontograma por defecto y solo gestiona metadatos de delegación. `usuario.profesional_id` se resuelve por request contra la base, nunca desde un claim del JWT (evita acceso stale tras desvincular).
- **Delegación temporal auditada** (`delegacion_hc`): habilita lectura/escritura de la HC de un paciente a otro profesional durante una ventana con vencimiento, para ausencias o derivaciones. Crear o revocar una delegación es un acto administrativo auditado que no revela contenido clínico.
- **Auditoría PHI append-only** (`auditoria_phi`): una fila por lectura/escritura de HC u odontograma y por intento denegado (`403`), en la misma transacción que la operación. El insert-only se enforza con triggers `BEFORE UPDATE`/`BEFORE DELETE` + `RAISE(ABORT)`; logs y errores siguen sin PHI.
- **Corrección de KB**: `knowledge-base/03-actores.md` deja de declarar "Dueño: Lectura" sobre HC/odontograma y pasa a "sin acceso"; la fila de Permisos se ajusta en el mismo change.
- **Fuera de alcance** (diferido, documentado en `design.md`): UI del odontograma y del historial, cifrado en reposo, endpoints de exportación/impresión, acceso del paciente a su propia HC (Ley 26.529, portal C-17), periodontograma, presupuestos (C-10).

## Capabilities

### New Capabilities

- `clinica/historia-clinica`: registro longitudinal de eventos clínicos inmutables por paciente, con enmiendas trazables y estado vigente derivado.
- `clinica/odontograma`: registro event-sourced de hallazgos por pieza FDI y superficie, con estado actual derivado y validación de combinaciones pieza→superficie.
- `clinica/acceso-hc`: reglas de alcance por profesional tratante, delegación temporal auditada y matriz de autorización de HC/odontograma por rol.
- `platform/auditoria-phi`: audit trail append-only de accesos a datos clínicos (lecturas, escrituras y denegaciones), sin PHI en el propio log.

### Modified Capabilities

- `auth/auth-roles`: incorpora la identidad `usuario.profesional_id` y la autorización acotada al profesional tratante (o delegado) para recursos clínicos.
- `core/models`: `paciente` gana `fecha_nacimiento` y `alergias`; el esquema base pasa a migraciones 001→008 con las nuevas entidades clínicas y sus repositorios.

## Impact

- `backend/src/shared/migrations.ts` — nueva `MIGRATION_008_CLINICA` registrada en `MIGRATIONS`.
- Nuevos: `backend/src/clinica/` (`historiaClinica.repository.ts`, `odontograma.repository.ts`, `delegacionHc.repository.ts`, `auditoriaPhi.repository.ts`, `fdi.ts`, `historiaClinica.service.ts`, `odontograma.service.ts`, `accesoHc.service.ts`, `historiaClinica.routes.ts`, `odontograma.routes.ts`, `delegacionesHc.routes.ts`, `pacientes.routes.ts`).
- `backend/src/core/models.ts` — filas `PacienteRow` y `UsuarioRow` extendidas.
- `backend/src/auth/middleware.ts` / `backend/src/shared/auth.ts` — resolución de `profesional_id` por request y guard de acceso clínico.
- `backend/src/shared/errors.ts` / `error-handler.ts` — errores tipados de HC/odontograma sin PHI.
- `backend/src/shared/app.ts` — montaje de los routers nuevos en `/api`.
- `backend/src/shared/seed.ts` — datos ficticios de profesional↔usuario y pacientes con fecha de nacimiento/alergias ficticias.
- `knowledge-base/03-actores.md` — corrección de la matriz de permisos (Dueño sin lectura de HC).
- Tests: `backend/tests/historia-clinica.test.ts`, `odontograma.test.ts`, `acceso-hc.test.ts`, `auditoria-phi.test.ts`, `migracion-008.test.ts`.
- Sin dependencias externas nuevas; sin ORM; sin cambios en la máquina de estados del turno ni en la lógica de agenda.
- Governance **CRITICAL** (R16): la implementación no arranca sin aprobación explícita del usuario.
