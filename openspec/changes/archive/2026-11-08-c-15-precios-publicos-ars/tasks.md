# Tasks

## 1. Persistencia y Migración 013

- [x] 1.1 Escribir test de migración en `tests/migrations_013.test.ts` e implementar `MIGRATION_013_PRECIOS_PUBLICOS` en `backend/src/shared/migrations.ts` agregando la columna `precio_base_centavos` a la tabla `prestacion` con constraint `CHECK (precio_base_centavos >= 0)` y registrarla en `MIGRATIONS`. Verificar con `npx vitest run tests/migrations_013.test.ts`.
- [x] 1.2 Extender la definición de `Prestacion` y DTOs en `backend/src/core/models.ts` con `precio_base_centavos: number` y actualizar los fixtures de prueba en `backend/src/shared/seed.ts` con valores en ARS centavos. Verificar con `npx vitest run tests/migrations.test.ts`.

## 2. Dominio y Formato de Moneda

- [x] 2.1 Implementar el formateador utilitario `formatearMonedaArs` en `backend/src/catalogo/formatoMoneda.ts` asegurando presentación determinista en pesos argentinos (`$ X.XXX,XX`) a partir de centavos enteros y verificar con tests unitarios en `tests/formato_moneda.test.ts`.
- [x] 2.2 Implementar `PrestacionRepository` en `backend/src/catalogo/prestacion.repository.ts` con operaciones `listarActivas`, `obtenerPorId` y `actualizarPrecio`, verificando persistencia y filtros en `tests/prestacion_repository.test.ts`.

## 3. Servicios y Endpoints HTTP (Públicos y RBAC)

- [x] 3.1 Implementar `CatalogoService` y el endpoint público `GET /api/public/prestaciones` en `backend/src/catalogo/catalogo.routes.ts` exponiendo duración, centavos y precio formateado. Verificar con tests de integración en `tests/catalogo_publico.test.ts`.
- [x] 3.2 Implementar los endpoints protegidos `GET /api/prestaciones` (lectura para roles `recepcion`, `profesional` y `administracion`) y `PUT /api/prestaciones/:id/precio` (restringido a `administracion`) en `backend/src/catalogo/catalogo.routes.ts` y montarlos en `backend/src/server.ts`. Verificar RBAC y validaciones en `tests/catalogo_auth.test.ts`.

## 4. Integración y Verificación Integral

- [x] 4.1 Verificar la coherencia del catálogo público con el flujo de reserva online y disponibilidad de turnos en `tests/reserva_online.test.ts`.
- [x] 4.2 Ejecutar suite integral de backend (`npm test` o `npx vitest run`) y chequeo de tipos (`npx tsc --noEmit`) asegurando que todos los tests previos y nuevos pasen en verde sin regresiones.

## Workflow follow-up

- Revisión del change bajo nivel de gobernanza BAJO.
- Archivar el change con `openspec archive c-15-precios-publicos-ars` y sincronizar specs de catálogo.
