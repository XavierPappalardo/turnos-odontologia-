# Proposal

## Why

La adopción requiere mostrar valor rápido y migrar datos existentes sin carga manual; hoy no hay demo instantánea ni importación asistida (D-05, KB-06/KB-09 Adopción/onboarding). C-20 habilita un flujo seguro de demo/migración para acelerar onboarding en consultorios pequeños.

## What Changes

- **Demo instantánea con datos ficticios:** acción administrativa/operativa controlada para cargar un conjunto de datos de demostración ficticios (idempotente/segura), sin datos reales (R1/R12).
- **Importador CSV/Excel para migración básica:** carga de archivos tabulares para `pacientes`, `profesionales` y `turnos` con mapeo de columnas, validaciones, modo *preview* (sin commit) y ejecución confirmada con reporte de errores por fila.
- **Validaciones y seguridad de importación:** rechazo de filas inválidas con motivos tipados, preservación de integridad referencial y reglas de agenda aplicables a turnos (incl. validaciones compatibles con R9 cuando corresponda); operaciones transaccionales/aisladas según diseño; sin PHI ni contenido sensible en logs/errores.
- **UI de carga/preview:** pantalla frontend (React/Vite/TS) para seleccionar archivo, previsualizar filas/mapeo, ver errores y confirmar importación o cargar demo.
- **Tests:** Vitest (Dado/Cuando/Entonces, SQLite real donde aplique) para importación válida/inválida, preview sin efectos persistentes y controles de autorización/seguridad.

## Capabilities

### New Capabilities
- `utilidades/demo-migracion-excel`: demo instantánea con datos ficticios e importación tabular (CSV/Excel) con preview, validación, mapeo y reporte de errores para migración básica de pacientes, profesionales y turnos.

### Modified Capabilities
- (none)

## Impact

- **Backend (`backend/src/`):** nuevo módulo de utilidades/importación (parseo CSV/Excel, validación, preview/commit, reporte) y endpoints admin con auth/RBAC; posible extensión/uso seguro del seed de datos ficticios existente (`shared/seed*`).
- **Frontend (`frontend/src/`):** nueva UI de carga/preview y acciones de demo/importación; integración con API autenticada.
- **Dependencias:** puede requerir librería de parseo para Excel/CSV en implementación (a definir en design; mantener superficie mínima). Sin credenciales externas.
- **Datos/reglas:** importación de turnos debe respetar referencias válidas y reglas de agenda/solapamiento cuando se persistan (R8/R9/R7/R11). Sin PHI en logs (R3); solo datos ficticios en seeds/fixtures (R1/R12).
- **Governance:** BAJO (R16). Depende de C-15 (satisfecha).
