# Tasks

> Strict TDD: cada tarea de implementación arranca con su test en rojo y cierra cuando el test pasa. Gobernanza **CRITICAL** (R16): nada de esto se ejecuta sin aprobación explícita del usuario.

## 1. Fundaciones compartidas

- [x] 1.1 Escribir `backend/tests/fechas.test.ts` (rojo) con ISO 8601 con `Z`, con offset, sin zona y valores inválidos; extraer el núcleo puro a `backend/src/shared/fechas.ts` (`normalizarIsoUtc`) y reutilizarlo desde `agenda/crearTurno.service.ts` sin cambiar `normalizarUtc`; verde con `npx vitest run tests/fechas.test.ts tests/crear_turno.test.ts tests/bloqueos.test.ts`
- [x] 1.2 Ampliar `backend/tests/errors.test.ts` (rojo) para `ValidacionClinicaError` (400), `AccesoHcError` (403 con `motivo`), `EnmiendaDuplicadaError` (409), `EventoNoEncontradoError` (404) y `EventoInmutableError` (409); implementarlos en `backend/src/shared/errors.ts` y verificar que `toBody()` no incluye PHI
- [x] 1.3 Escribir `backend/tests/append_only.test.ts` (rojo) sobre una tabla fixture con solo `created_at`; implementar `AppendOnlyRepository<T>` en `backend/src/shared/repository.ts` (insert sin `updated_at`, `update`/`softDelete` lanzan `EventoInmutableError`); verde con `npx vitest run tests/append_only.test.ts`
- [x] 1.4 Agregar brand types `HcEventoId`, `OdontogramaEventoId`, `DelegacionHcId` y los tipos `TipoEventoHc`, `SuperficieFdi`, `HallazgoOdontograma` a `backend/src/shared/types.ts`; verificar con `npx tsc --noEmit`
- [x] 1.5 Ampliar `backend/tests/auth.test.ts` (rojo) para `AuthContext.profesionalId` resuelto por request; ajustar `backend/src/auth/types.ts` y el guard que lo completa; verde con `npx vitest run tests/auth.test.ts`

## 2. Migración 008 y esquema clínico

- [x] 2.1 Escribir `backend/tests/migracion_008.test.ts` (rojo): columnas `paciente.fecha_nacimiento`/`alergias` y `usuario.profesional_id`, tablas `hc_evento`/`odontograma_evento`/`delegacion_hc`/`auditoria_phi`, índices y UNIQUE parcial de `enmienda_de`
- [x] 2.2 Escribir en el mismo test (rojo) los CHECKs: pieza `19`/`49`/`00`/`86` rechazadas, superficie y hallazgo fuera de catálogo rechazados, `detalle` vacío/5001 rechazado, enmienda sin motivo rechazada
- [x] 2.3 Implementar `MIGRATION_008_CLINICA` en `backend/src/shared/migrations.ts` y registrarla en `MIGRATIONS`; verde 2.1–2.2 con `npx vitest run tests/migracion_008.test.ts`
- [x] 2.4 Escribir en `migracion_008.test.ts` (rojo) los casos de `UPDATE`/`DELETE` directos sobre las tres tablas de eventos (abortan por trigger) y de FK/UNIQUE de `usuario.profesional_id`; agregar triggers y completar el esquema hasta verde
- [x] 2.5 Extender `PacienteRow`/`UsuarioRow` en `backend/src/core/models.ts` y crear `backend/src/core/paciente.repository.ts` con `findVigente` y actualización de `fecha_nacimiento`/`alergias`; test (rojo) `backend/tests/paciente_repository.test.ts`, verde
- [x] 2.6 Actualizar el seed ficticio (`backend/src/shared/seed.ts`) con un usuario profesional vinculado y pacientes con fecha de nacimiento/alergias ficticias; verificar idempotencia con `npx vitest run tests/core_models.test.ts`

## 3. Dominio FDI

- [x] 3.1 Escribir `backend/tests/fdi.test.ts` (rojo) table-driven: piezas 11–48 y 51–85 válidas, `19`/`49`/`00`/`86` inválidas, superficies fuera de `M,D,V,L,O,I` inválidas
- [x] 3.2 Implementar `backend/src/clinica/fdi.ts` (`esPiezaFdiValida`, `esSuperficieValida`, `esCombinacionValida`); verde con `npx vitest run tests/fdi.test.ts`
- [x] 3.3 Triangulación en `fdi.test.ts`: matriz completa (incisivos/caninos con `I`, premolares/molares con `O`, temporales 51–53 y 54–55, `M/D/V/L` en todas) y total de 52 piezas aceptadas; verde

## 4. Auditoría PHI

- [x] 4.1 Escribir `backend/tests/auditoria_phi.test.ts` (rojo) del repositorio: inserta una fila con todos los campos y recupera por paciente y por usuario; implementar `backend/src/clinica/auditoriaPhi.repository.ts` sobre `AppendOnlyRepository`; verde
- [x] 4.2 Test (rojo) del servicio `backend/src/clinica/auditoriaPhi.service.ts`: `registrar()` deriva `session_id` del `jti`, no persiste el token y arma filas `permitido`/`denegado` con `motivo`; verde
- [x] 4.3 Test (rojo) de contenido: una fila generada tras leer una HC ficticia no contiene el nombre del paciente ni el `detalle` clínico; verde

## 5. Acceso a historia clínica

- [x] 5.1 Escribir `backend/tests/acceso_hc.test.ts` (rojo): `profesional_id` `null` → 403, profesional resuelto por request y desvinculación con token vigente → 403 inmediato; implementar `backend/src/clinica/resolverProfesional.ts`; verde
- [x] 5.2 Test (rojo) del alcance "sus pacientes": turno `cancelado` habilita, sin turno → 403, turno con otro profesional → 403; implementar `backend/src/clinica/accesoHc.service.ts` (`esTitular`) y el guard clínico; verde
- [x] 5.3 Test (rojo) de delegaciones: alta por titular y por administración (solo metadatos), lectura/escritura del delegado vigente, vencida → 403, revocada → 403, delegado sin `profesional_id` → 400, `hasta <= desde` → 400, recepción → 403; implementar `delegacionHc.repository.ts` y `delegacionesHc.routes.ts`; verde
- [x] 5.4 Test (rojo): paciente inexistente y paciente ajeno devuelven el mismo `403` con el mismo cuerpo; verde
- [x] 5.5 Test (rojo) de auditoría en el guard: cada 403 genera una fila `denegado` con `sin_vinculo`, `rol_no_autorizado` o `delegacion_vencida`; verde

## 6. Historia clínica

- [x] 6.1 Escribir `backend/tests/historia_clinica.test.ts` (rojo) del repositorio: insert, listado por `ocurrido_en` e `id`, `findById`, `existeEnmiendaDe`, `perteneceAPaciente`; implementar `backend/src/clinica/historiaClinica.repository.ts`; verde
- [x] 6.2 Test (rojo) del servicio: catálogo de `tipo`, `detalle` 1..5000, `ocurrido_en` normalizado a UTC, `turno_id` del paciente, filtro por turno, `es_vigente`; verde
- [x] 6.3 Test (rojo) de enmiendas: hereda `ocurrido_en` del original, original intacto, doble enmienda → 409, evento de otro paciente → 404; verde
- [x] 6.4 Implementar `backend/src/clinica/historiaClinica.service.ts` hasta verde 6.2–6.3
- [x] 6.5 Test (rojo) de rutas con supertest (`201`, `200`, `400`, `403`, `404`, `409`) y montaje en `shared/app.ts`; implementar `backend/src/clinica/historiaClinica.routes.ts`; verde

## 7. Odontograma

- [x] 7.1 Escribir `backend/tests/odontograma.test.ts` (rojo) del repositorio: insert, estado actual con `ROW_NUMBER` (último no enmendado, desempate por `id`), historial por pieza, eventos enmendados excluidos; implementar `backend/src/clinica/odontograma.repository.ts`; verde
- [x] 7.2 Test (rojo) del servicio: validación `esCombinacionValida`, `ocurrido_en` UTC, `turno_id` del paciente, enmienda hereda instante y no pisa evolución posterior; verde
- [x] 7.3 Implementar `backend/src/clinica/odontograma.service.ts` hasta verde 7.1–7.2
- [x] 7.4 Test (rojo) de rutas y montaje: estado, historial con `pieza=` (inválida → 400), alta de evento, enmienda; implementar `backend/src/clinica/odontograma.routes.ts`; verde

## 8. Datos clínicos del paciente y KB

- [x] 8.1 Escribir `backend/tests/paciente_datos.test.ts` (rojo): allowlist (`nombre` → 400), fecha `YYYY-MM-DD` no futura, `alergias` > 2000 → 400, `""` → `NULL`, administración con id inexistente → 404, campo sin permiso por rol → 403
- [x] 8.2 Implementar `backend/src/core/paciente.service.ts`, `backend/src/clinica/pacientes.routes.ts` y el montaje en `shared/app.ts`; verde con `npx vitest run tests/paciente_datos.test.ts`
- [x] 8.3 Corregir `knowledge-base/03-actores.md`: Dueño y Recepción "No accede" en HC/odontograma, Odontólogo "Sus pacientes (o delegación vigente)" y nota de delegación; verificar por inspección del archivo

## 9. Integración y verificación

- [x] 9.1 Escribir `backend/tests/clinica_integracion.test.ts` (rojo): profesional con turno registra HC y odontograma, enmienda, otorga delegación, el delegado accede y recepción recibe 403; cada operación deja exactamente una fila en `auditoria_phi`; verde
- [x] 9.2 Capturar el logger en `clinica_integracion.test.ts` y afirmar que ni logs ni cuerpos de error contienen el nombre del paciente ni el `detalle` ficticio (R3); verde
- [x] 9.3 Ejecutar `npx tsc --noEmit` sin errores y `npx vitest run` con toda la suite verde

## Workflow follow-up

- Revisión humana explícita del diseño y del diff (governance CRITICAL, R16) antes de mergear.
- Archivar el change con `/opsx:archive` y sincronizar los delta specs a `openspec/specs/`.
- Actualizar `CHANGES.md`: marcar C-09 y corregir la numeración de migraciones corridas (C-10→009, C-11→010, C-12→011, C-13→012, C-15→013).
