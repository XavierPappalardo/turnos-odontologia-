# Design

## Context

C-20 (D-05, BAJO, deps C-15) agrega demo instantánea y migración tabular básica. Ver `proposal.md` (motivación) y `specs/utilidades/demo-migracion-excel/spec.md` (contrato). Restricciones: TS+Node/Express+SQLite+Vitest (R7), R8, R1/R3/R12/R15. Estado actual: `backend/src/shared/seed.ts`/`seed-cli.ts` cargan datos ficticios idempotentes; backend solo depende de Express (sin parser multipart/Excel); frontend es React+Vite+TS mínimo (`App.tsx` renderiza header + portal paciente, sin router/auth UI completo).

## Goals / Non-Goals

**Goals:**
- Proveer demo ficticia cargable por admin de forma segura/idempotente.
- Importar `pacientes`, `profesionales` y `turnos` desde CSV/Excel con mapeo, validación, **preview sin commit**, confirmación controlada y reporte por fila.
- Aplicar auth/RBAC admin, transacciones/validaciones seguras y controles R3/R1 (sin PHI en logs/respuestas; datos demo ficticios).

**Non-Goals:**
- Migración completa de todo el dominio (obras sociales, caja, HC, etc.) o sincronización continua.
- ETL productivo masivo, rollback automático complejo de importaciones confirmadas.
- Integración con servicios externos ni procesamiento con credenciales reales.
- UI/admin completa de autenticación si el frontend actual no la provee (se implementa superficie mínima funcional).

## Decisions

1. **Módulo/capacidad**: `utilidades/demo-migracion-excel` bajo `backend/src/utilidades/demo-migracion-excel/` (parser/normalizador, validadores por entidad, servicio preview+confirm, repos/helpers transaccionales R8/UoW, rutas admin). *Alternativa*: scripts CLI-only — insuficiente porque el scope exige UI + preview.

2. **API admin (JSON, sin multipart en MVP)**: endpoints protegidos (`requireAuth` + `requireRoles('administracion')`), p. ej. `POST /api/utilidades/demo`, `POST /api/utilidades/importacion/preview`, `POST /api/utilidades/importacion/confirmar`. Payload JSON con `{ entidad, formato, contenido }` donde `contenido` es texto CSV o base64 del archivo (browser FileReader) + `mapeo`/opciones seguras. *Alternativa*: `multipart/form-data` (multer/busboy) — viable en implementación, pero agrega dependencia/config; JSON evita nueva dep de upload. *Decisión operativa*: soportar CSV de forma nativa/mínima; Excel (`.xlsx`) mediante dependencia de parseo tabular agregada en implementación si se requiere (superficie mínima, sin red). El contrato de spec exige soportar formatos declarados; la implementación debe documentar formatos efectivamente soportados.

3. **Preview vs confirmar**: preview parsea/valida/mapea y retorna `{ resumen, filasValidas?, errores[], muestrasSeguras }` **sin writes**. Confirmar **revalida** el payload completo (no confiar en un preview previo manipulable) y persiste solo filas aceptadas según regla definida (transacción por lote/operación con reporte; evitar estado parcial indebido). *Alternativa*: token de preview firmado — más complejo para BAJO/MVP.

4. **Validación por entidad**:
   - `profesional`/`paciente`: campos requeridos, formatos básicos, normalización segura; duplicados detectados por claves naturales/estrategia definida (idempotencia configurable o rechazo con reporte).
   - `turno`: requiere referencias válidas (ids o claves resolubles definidas por mapeo), `fin > inicio`, estado válido. Para estados **activos** (`reservado/confirmado/presente`) se aplican validaciones compatibles con R9/anti-solapamiento en la estrategia de confirmación; para estados históricos no activos se permite importación sin ocupar agenda, sujeto a integridad. Filas inválidas se rechazan con motivo tipado. *Alternativa*: importar turnos sin validar solapes — rechazado por seguridad/integridad.

5. **Demo instantánea**: reutiliza/extiende `seedMinimo` (idempotente, `insertOrIgnore`/checks) y opcionalmente usuarios demo solo si se solicita explícitamente y con controles seguros; datos estrictamente ficticios. Expuesta solo a `administracion`.

6. **Privacidad/logging (R3/R1)**: nunca loguear filas completas ni campos sensibles importados; logs solo con ids opacos/entidad/conteos/códigos de error. Respuestas de error tipadas, sin volcar contenido. Tests deben asertar ausencia de PHI en salidas operativas.

7. **Frontend (mínimo viable)**: agregar vista/componente React en `frontend/src/` (p. ej. `utilidades/MigracionDemo.tsx`) con selector de entidad, input de archivo (FileReader → texto/base64), mapeo básico si aplica, acción Preview, tabla/resumen de errores y confirmación. Integrar en `App.tsx` de forma mínima (panel condicional/hash) dado que no hay router/auth completo; llamadas a API requieren token admin (mecanismo mínimo documentado en UI, sin hardcodear secretos). *Alternativa*: router completo + login UI — fuera de alcance salvo necesidad mínima; no asumir infraestructura inexistente.

## Risks / Trade-offs

- [Excel/dep de parseo] → CSV base sin dep pesada; Excel requiere librería en implementación (revisar licencia/superficie). Mitigar con formatos soportados declarados y tests.
- [Importar turnos activos viola R9] → validar refs y solapamiento/integridad para estados activos; rechazar filas conflictivas con reporte. → Mitigación.
- [Archivos grandes/memoria] → límites de tamaño/filas en config o validación; procesamiento por lotes en implementación. → Mitigación.
- [Frontend sin auth completa] → UI mínima opera con API admin; documentar prerequisito de token admin. No exponer secretos. → Mitigación.
- [Reconfirmación manipula datos] → revalidar en confirmar; no confiar en preview. → Mitigación.
- [PHI en archivos importados] → no persistir en logs; tratar contenido como sensible en manejo operativa; respuestas seguras. → Mitigación (R3).

## Migration Plan

1. (Impl) Agregar módulo backend + rutas + tests; extender frontend con UI mínima; agregar dep de parseo solo si necesaria.
2. Verificar `tsc --noEmit`/tests backend y checks frontend si se toca UI (`tsc -b`/`vitest`/`lint` según scripts).
3. **Rollback**: revertir change; sin migración DB nueva prevista salvo que diseño la requiera (preferir no agregar tablas).

## Open Questions

- **Mapeo de IDs en migración**: si el archivo trae IDs externos, ¿se preservan como claves de mapeo temporales o se generan IDs internos? Resolver en implementación con una estrategia determinista documentada en el contrato de importación/UI, sin cambiar el comportamiento observable de preview/confirm/reporte.
- **Duplicados en confirmación**: política exacta (rechazar, omitir si existe, actualizar) por entidad; implementar conservadoramente (rechazar/omitir con reporte) salvo que el contrato de UI lo haga explícito.
- **Auth UX frontend**: si se requiere pantalla de login admin, es trabajo adicional acotado; por defecto usar integración mínima con el estado actual del frontend.
