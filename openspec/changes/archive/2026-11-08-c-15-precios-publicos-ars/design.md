# Design: C-15 Precios Públicos en ARS

## Context

El sistema cuenta con un catálogo base de prestaciones (`prestacion`) inicializado en la migración `001` con código, nombre y duración en minutos. Hasta la fecha, los montos monetarios se han modelado con éxito en centavos enteros (`INTEGER NOT NULL CHECK (... >= 0)`) en los módulos de `caja`, `obras-sociales`, `clinica/presupuestos` y `comisiones`. Esta arquitectura extiende la tabla `prestacion` para soportar precios base en ARS y expone endpoints públicos para la reserva online y privados para gestión de tarifas bajo RBAC.

## UI Mockups Gate

`Decision: no (no UI)` — Este change implementa persistencia, lógica de negocio y APIs REST backend; no introduce ni modifica pantallas o componentes visuales.

## Goals / Non-Goals

**Goals:**
- Extender la entidad y tabla `prestacion` con `precio_base_centavos` (ARS en centavos enteros, CHECK >= 0).
- Diseñar la migración `013` de forma idempotente y compatible con SQLite en modo WAL y transacciones inmediatas.
- Exponer `GET /api/public/prestaciones` para consumo abierto en reserva online con formato de moneda en presentación (`$ X.XXX,XX`).
- Exponer `GET /api/prestaciones` (lectura para recepción, profesional y administración) y `PUT /api/prestaciones/:id/precio` (modificación exclusiva para administración).
- Proveer utilitarios de conversión y formato monetario para presentación sin usar coma flotante en operaciones aritméticas.

**Non-Goals:**
- Listas de precios múltiples o diferenciadas por convenio en esta etapa (las obras sociales ya gestionan sus porcentajes y copagos vía `obras-sociales/cobertura`).
- Historial o versionado temporal de precios con vigencias futuras.
- Facturación electrónica con AFIP (postergado explícitamente a fase 2 por decisión D2).

## Decisions

### D1: Columna directa en tabla `prestacion` vs tabla de precios independiente
- **Decisión**: Añadir `precio_base_centavos` directamente en la tabla `prestacion` mediante `ALTER TABLE prestacion ADD COLUMN precio_base_centavos INTEGER NOT NULL DEFAULT 0 CHECK (precio_base_centavos >= 0);`.
- **Justificación**: Mantiene el modelo simple y con transacciones directas. Cada prestación posee un único precio de referencia de lista para pacientes particulares y base de cálculo de presupuestos.
- **Alternativas consideradas**:
  - *Tabla `catalogo_precios_historico`*: Aportaba complejidad innecesaria en este estadio sin requerimientos de vigencias fechadas.

### D2: Módulo `backend/src/catalogo/`
- **Decisión**: Encapsular el dominio en `backend/src/catalogo/` (`prestacion.repository.ts`, `catalogo.service.ts`, `catalogo.routes.ts`, `formatoMoneda.ts`).
- **Justificación**: Sigue la arquitectura monolítica modular establecida en `caja/`, `obras-sociales/`, `agenda/` y `comisiones/`.
- **Alternativas consideradas**:
  - *Ubicar en `core/`*: Se descartó para reservar `core/` para modelos de datos transversales compartidos y repositorios genéricos (`BaseRepository`, `UnitOfWork`).

### D3: Formateo monetario en capa de presentación (R2, R5)
- **Decisión**: Implementar `formatearMonedaArs(centavos: number): string` retornando cadenas con formato local argentino (separador de miles con punto, decimales con coma, ej: `"$ 15.000,00"`).
- **Justificación**: Prohíbe terminantemente el uso de tipos float en el dominio y persistencia. La conversión y formateo ocurre en el DTO de respuesta.
- **Alternativas consideradas**:
  - *Retornar números flotantes en JSON*: Rechazado por riesgo de imprecisión en clientes y ruptura de R2.

### D4: Control de Acceso (RBAC) y Seguridad
- **Decisión**:
  - `GET /api/public/prestaciones`: Acceso público sin JWT, filtrando `activo = 1`.
  - `GET /api/prestaciones`: Requiere token JWT con roles `recepcion`, `profesional` o `administracion`.
  - `PUT /api/prestaciones/:id/precio`: Requiere token JWT y rol `administracion`.
- **Justificación**: Alínea los privilegios de gobernanza financiera; recepción no debe alterar la política de precios de la clínica.

## Risks / Trade-offs

- **[Riesgo] Migración sobre prestaciones existentes sin precio asignado**:
  - *Mitigación*: Se utiliza `DEFAULT 0` en la columna y se actualizan los fixtures de seed con precios representativos de mercado para evitar prestaciones con costo cero en entornos de prueba y demostración.
- **[Riesgo] Formateo numérico inconsistente entre entornos**:
  - *Mitigación*: El formateador `formatearMonedaArs` utiliza un algoritmo determinista de separación de miles y decimales sin depender de configuraciones regionales del sistema operativo host.

## Migration Plan

1. Crear script `MIGRATION_013_PRECIOS_PUBLICOS` en `backend/src/shared/migrations.ts`.
2. Registrar la migración en el array `MIGRATIONS`.
3. Al arrancar el servidor o ejecutar tests, `runMigrations` aplicará automáticamente la migración en SQLite.
4. Actualizar el seed de datos en `backend/src/shared/seed.ts` con precios realistas en centavos para prestaciones de demostración.
