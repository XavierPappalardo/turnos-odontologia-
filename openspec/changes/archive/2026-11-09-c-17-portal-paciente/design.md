# Design

## Context

`C-17` (`portal-paciente`, D-02, MEDIO) agrega un portal básico para pacientes tras `C-15`. La base actual incluye: agenda/turnos con transiciones y validaciones (`backend/src/agenda/*`), acciones públicas por token de turno (`turnoToken.*`, `turno_token`), presupuestos en `backend/src/clinica/presupuestos.*` (rutas staff bajo `/api`), y un frontend mínimo React+Vite en `frontend/`. No existe modelo documental dedicado identificado en el MVP. Ver `proposal.md` (Why/assumptions) y `specs/portal/paciente/spec.md` para requisitos.

Restricciones: TS + Node/Express + SQLite + Vitest (R7), acceso a datos vía repositorios/UoW (R8), escrituras de turno con solapamiento en `BEGIN IMMEDIATE`/semántica vigente (R9), sin PHI en logs/respuestas/URLs sensibles (R1/R3), datos ficticios en tests (R12), sin secretos reales (R15), change MEDIO (R16) — requiere cuidado en auth/scoping.

## Goals / Non-Goals

**Goals:**
- Entregar portal paciente accesible por **token/link opaco** (sin cuentas/contraseñas) con scoping estricto a `paciente_id`.
- Secciones: mis turnos, mis presupuestos, documentos (MVP seguro/vacío o referencias existentes si aparecen; sin storage documental nuevo).
- Autogestión: confirmar/cancelar/reprogramar turnos propios reutilizando reglas/transiciones/validaciones existentes (C-04/C-06/C-05/RN-01/02/03/04/06 según aplique).
- UI básica responsive en `frontend/` + endpoints backend dedicados; tests Dado/Cuando/Entonces, SQLite real para reglas críticas.

**Non-Goals:**
- Login/registro de pacientes con contraseña, OAuth, verificación de identidad fuerte.
- Exposición de HC/odontograma/PHI clínica al paciente (R4/R16 CRITICAL fuera de scope de este change).
- Creación/edición de presupuestos desde portal (read-only).
- Sistema nuevo de carga/gestión documental, firma digital, facturación AFIP/PUCO, app móvil, API pública.
- Notificaciones salientes nuevas más allá de hooks ya existentes en servicios reutilizados.

## Decisions

1. **Acceso por token de portal (paciente-scoped), no cuenta de usuario**
   - *Rationale*: cumple “autenticación paciente mínima o acceso por link/token” con complejidad baja y patrones existentes (tokens opacos/hash como C-06). Evita manejo de credenciales de pacientes.
   - *Alternativa*: JWT de paciente/cuenta mínima — mayor superficie (registro, reset, PII adicional). Dejar para follow-up si D-02 crece.
   - *Detalle esperado en implementación*: persistir token como hash (nunca texto plano reutilizable), asociar `paciente_id`, `expires_at`, estado/revocación/uso según diseño final; validar en middleware; rate limit por IP/contexto público.

2. **API portal separada de rutas staff**
   - *Rationale*: evita acoplar controles clínicos/staff (`presupuestosRouter` bajo `/api` con auth clínica en ítems) con acceso paciente. Permite DTOs/queries acotadas por `paciente_id`.
   - *Alternativa*: reutilizar endpoints staff con ramas por rol — riesgo de filtración/scoping incorrecto (R3/R4). Rechazada.
   - *Forma*: rutas bajo namespace público/portal (p. ej. `/api/portal/...` o `/api/public/portal/...`) con middleware de token portal; acciones de turno pueden delegar a servicios existentes tras validar pertenencia del turno al paciente.

3. **Acciones de turno delegadas a lógica existente**
   - *Rationale*: no duplicar máquina de estados/solapamientos. `confirmar/cancelar/reprogramar` deben respetar RN-06, transiciones y anti-solapamiento/bloqueos.
   - *Alternativa*: reimplementar en portal — divergencia y riesgo de bypass (inaceptable). Rechazada.
   - *Detalle*: si se reutiliza `turnoToken`/servicios, la capa portal debe primero verificar que el turno pertenece al `paciente_id` del token; nunca aceptar `turno_id` ajeno. Preferir interfaz de servicio interna que acepte contexto paciente validado.

4. **Presupuestos en modo read-only, consultas por paciente**
   - *Rationale*: CHANGES pide visualización; KB limita edición clínica. Portal no debe exponer mutaciones ni detalles clínicos sensibles innecesarios.
   - *Detalle*: endpoint/listado acotado por `paciente_id`; presentar montos ARS de forma consistente con dominio (centavos en API interna si ya es patrón; formato presentación en UI). Sin acceso a ítems clínicos vinculados a odontograma más allá de lo estrictamente necesario y seguro — design/spec de implementación deberá acotar DTO.

5. **Documentos: contrato seguro, sin storage nuevo en MVP**
   - *Rationale*: no hay entidad documental dedicada encontrada; inventar storage amplía alcance y riesgo PHI.
   - *Alternativa*: adjuntar HC/exportes — toca dominio clínico CRITICAL y permisos sensibles. Fuera de scope.
   - *Detalle*: API/UI devuelven lista vacía o referencias ya modeladas/publicables si existen; mensaje/estado claro; estructura extensible.

6. **Frontend mínimo integrado al Vite existente**
   - *Rationale*: repo ya tiene `frontend/` React+Vite+TS; evita introducir stack (R7). UI responsive básica, rutas simples (token en path/query/fragment según decisión segura en implementación — evitar PHI; preferir fragmento o entrada controlada y no loguear).
   - *Alternativa*: SSR/framework nuevo — innecesario. Rechazada.

## Risks / Trade-offs

- [Token de portal filtrado en link] → expiración corta configurable, posibilidad de revocación, no loguear token completo, rate limit, HTTPS en despliegue real (fuera de este repo, documentar), minimizar exposición en query params/logs.
- [Scoping incorrecto expone datos ajenos] → tests de autorización por `paciente_id`, consultas siempre filtradas por paciente del token, errores 404/403 tipados sin confirmar existencia de recursos ajenos.
- [Reprogramación/acciones duplican paths de seguridad] → delegar a servicios validados + asserts de pertenencia; tests de conflicto/anticipación/ajeno.
- [“Documentos” ambiguo para usuario] → UI/copy explícita “sin documentos disponibles” o referencias reales solo si existen; no prometer clínica.
- [Frontend mínimo sin diseño complejo] → cumple “UI básica responsive”; accesibilidad básica razonable, sin framework UI nuevo.
- [Sin cuenta paciente] → UX depende de recibir link/token por canal seguro; emisión/entrega del token es parte de implementación operativa (staff o flujo futuro) — acotar en tasks.

## Migration Plan

- Agregar migración incremental (siguiente ID disponible al implementar, esperado `015` si 014 ya existe) para tabla(s) de acceso portal (tokens hasheados, paciente, expiración, metadatos mínimos no-PHI). Ejecutar con runner existente, idempotente.
- Desplegar backend + frontend; endpoints portal detrás de rate limit. Rollback: revertir código/migración solo si no hay datos dependientes; como tabla nueva, rollback típico es release revert + migración down manual no estándar en este runner — preferir feature flag/config si se requiere mitigación rápida.

## Open Questions

- **Emisión del link/token al paciente**: ¿lo genera recepción/staff desde UI interna, se envía por WhatsApp (integración futura), o ambos? (afecta tareas de entrega, no el contrato de acceso si el token es opaco) — resolver en implementación con criterio mínimo seguro.
- **DTO de presupuestos en portal**: ¿incluir ítems no clínicos completos o resumen? acotar al implementar para minimizar exposición innecesaria, manteniendo utilidad.
- **Modelo documental futuro**: si antes de aplicar aparece una entidad “documento”, adaptar sección para listar solo referencias autorizadas; hoy se asume vacío/placeholder seguro.
