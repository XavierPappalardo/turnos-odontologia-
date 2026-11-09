# Proposal

## Why

Tras `C-15` (GATE 10) y con la agenda/gestión de turnos ya operativa, el paciente todavía depende de canales fragmentados para consultar sus turnos/presupuestos y autogestionar cambios. `C-17` (D-02, fase 2 temprana) agrega un portal paciente básico para reducir fricción operativa y mejorar autoservicio, sin ampliar el alcance a facturación/HC clínica expuesta al paciente más allá de lo definido.

## What Changes

- Agregar un **portal del paciente** con UI básica responsive (frontend React/Vite existente) y endpoints backend dedicados, accesibles por **link/token de acceso al portal** (acceso mínimo, sin cuentas/contraseñas en esta entrega).
- Exponer secciones de solo lectura/autogestión acotadas al paciente autenticado por token opaco: **mis turnos**, **mis presupuestos** y **documentos** (MVP: listado seguro/vacío o referencias disponibles; sin nuevo sistema de almacenamiento documental si no existe entidad/modelo vigente).
- Permitir acciones propias sobre turnos del paciente: **confirmar, cancelar y reprogramar**, reutilizando las validaciones/transiciones existentes de agenda (estados, anticipación RN-06, anti-solapamiento RN-01/RN-02/RN-04/RN-03 donde aplique) y sin exponer operaciones de staff.
- Agregar persistencia/configuración mínima necesaria para tokens/sesiones de portal (migración nueva si aplica), rate limiting, manejo de errores tipados y respuestas/logs sin PHI (R1/R3/R15).
- Agregar tests Vitest Dado/Cuando/Entonces (SQLite real cuando aplique a reglas críticas/transacciones) para acceso, scoping por paciente, visualización segura y acciones.

## Capabilities

### New Capabilities
- `portal/paciente`: Portal web para pacientes (acceso por token/link opaco) que permite consultar sus propios turnos/presupuestos/documentos disponibles y ejecutar acciones permitidas sobre sus turnos, con controles de privacidad y scoping estricto.

### Modified Capabilities
<!-- No se prevén cambios de requisitos a nivel spec en capacidades existentes; C-17 reutiliza comportamientos vigentes de agenda/presupuestos/auth público. Si durante design se detecta un cambio de requisito observable, se agregará delta spec explícita. -->
- (none)

## Impact

- **Backend (`backend/src/`)**: nuevo módulo/rutas de portal (p. ej. `portal/*`), middleware/servicio de validación de token portal, consultas acotadas por `paciente_id`, integración con servicios de turno/reprogramación y presupuestos; posible migración en `shared/migrations.ts` + config en `shared/config.ts`; montaje en `shared/app.ts`.
- **Frontend (`frontend/`)**: nuevas vistas/componentes/ruteo básico responsive para acceso por link/token y secciones turnos/presupuestos/documentos; consumo de APIs portal; sin cambios de stack (React + Vite + TypeScript).
- **APIs**: nuevos endpoints públicos/portal con token opaco (contrato a definir en design/spec); no modifica contratos staff existentes salvo integración interna.
- **Seguridad/privacidad**: scoping estricto por paciente, sin PHI en logs/errores/query params sensibles; tokens opacos, expiración y límites; datos ficticios en tests/fixtures (R1/R3/R4/R15/R16 MEDIO).
- **Dependencias/sistemas**: depende de `C-15` (completo). Reutiliza agenda/C-06 (acciones/transiciones), presupuestos/C-10 y patrones de tokens públicos; no requiere credenciales externas reales.

## Assumptions

- `CHANGES.md` referencia `CU-9` en `knowledge-base/07-flujos.md`; no se encontró una sección `CU-9` explícita. Se planifica según D-02, actores KB-03 y scope C-17.
- “Autenticación paciente mínima o acceso por link/token”: se asume **acceso por token/link opaco** (sin cuentas de paciente) para MVP; un mecanismo de login mínimo puede evaluarse en follow-up si se requiere.
- “Documentos”: no hay entidad/modelo documental dedicado identificado en el MVP actual; el portal expondrá una sección segura (vacía o con referencias ya disponibles) con contrato extensible, sin crear almacenamiento documental nuevo en este change.
