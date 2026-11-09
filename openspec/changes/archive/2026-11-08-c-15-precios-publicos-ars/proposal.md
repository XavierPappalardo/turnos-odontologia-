# Proposal: C-15 Precios Públicos en ARS

## Why

El modelo comercial del proyecto exige transparencia de precios en ARS desde el lanzamiento (D7, F-12, RN-12), diferenciándose de plataformas con cotizaciones opacas. Actualmente el catálogo de prestaciones define código, nombre y duración, pero carece de un modelo explícito de precios base en moneda de curso legal (ARS en centavos enteros) y de endpoints para su exposición pública durante el flujo de reserva online y su administración interna con control de roles. Esta funcionalidad estandariza el manejo monetario del catálogo previo al desarrollo de los diferenciadores de automatización y canales conversacionales.

## What Changes

- **Modelo y persistencia de precios en catálogo (Migración 013)**: Incorporación de `precio_base_centavos INTEGER NOT NULL DEFAULT 0 CHECK (precio_base_centavos >= 0)` en la tabla `prestacion`, garantizando integridad financiera en moneda ARS sin valores de punto flotante (R2, R5).
- **Servicio y repositorio de catálogo de prestaciones**: Métodos para consultar prestaciones activas con sus precios base y actualizar precios con auditoría básica de actualización (`updated_at`).
- **Endpoint público de catálogo y precios (`GET /api/public/prestaciones`)**: Exposición sin autenticación requerida para soporte del flujo de reserva online y transparencia al paciente. Devuelve datos de cada prestación incluyendo `duracion_min`, `precio_base_centavos` y el precio formateado en ARS (`$ X.XXX,XX`) para la capa de presentación.
- **Endpoints administrativos de catálogo de prestaciones**:
  - `GET /api/prestaciones`: Listado interno de prestaciones y precios para recepción y administración.
  - `PUT /api/prestaciones/:id/precio`: Actualización de precio base en centavos restringida al rol `administracion`.
- **Integración con reserva online**: Exposición y validación de la información de precios dentro del ecosistema de reserva pública.
- **Suite de pruebas de consistencia y moneda**: Escenarios en Vitest bajo convención Dado/Cuando/Entonces que validan integridad en centavos enteros, rechazo de valores negativos o flotantes, formato en presentación, y control RBAC.

## Capabilities

### New Capabilities
- `catalogo/precios`: Catálogo unificado de prestaciones odontológicas con precios base en ARS (enteros centavos), exposición pública para reserva online y gestión administrativa de tarifas según RBAC.

### Modified Capabilities
<!-- Ninguna capability existente modifica sus requerimientos contractuales -->

## Impact

- **Base de datos**: Nueva migración `013` que añade `precio_base_centavos` a `prestacion`.
- **Backend**:
  - `backend/src/shared/migrations.ts`: Registro de `MIGRATION_013_PRECIOS_PUBLICOS`.
  - `backend/src/core/models.ts`: Tipado ampliado de `Prestacion` con `precioBaseCentavos`.
  - `backend/src/catalogo/`: Nuevo módulo para repositorio, servicio y controladores de prestaciones/precios.
  - `backend/src/server.ts`: Montaje de rutas públicas `/api/public/prestaciones` y protegidas `/api/prestaciones`.
- **APIs**:
  - Nuevas rutas públicas `GET /api/public/prestaciones`.
  - Nuevas rutas protegidas `GET /api/prestaciones` y `PUT /api/prestaciones/:id/precio`.
- **Dependencias**: Sin nuevas dependencias npm; usa Node.js native SQLite y Vitest existente.
