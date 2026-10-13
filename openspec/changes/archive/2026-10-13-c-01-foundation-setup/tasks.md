# Tasks — c-01-foundation-setup

## 1. Absorber y verificar el scaffold backend existente (C-04)

- [x] 1.1 Verificar contra el repo que el scaffold heredado de C-04 sigue presente e intacto (`backend/src/shared/*`, `backend/src/agenda/*`, `backend/tests/crear_turno.test.ts`) y confirmar con `npm run typecheck` + `npm test` en `backend/` que la suite `crear_turno.test.ts` corre verde sin editarla
- [x] 1.2 Confirmar que se preservan las firmas/exportaciones que C-04 consume (`createApp`, `openDatabase`, `applyMigration003`, `BaseRepository`, `UnitOfWork`, `CrearTurnoError`, brand types, `turnosRouter`) y registrar el inventario absorbido en `backend/README.md` con verificación por inspección de imports del test existente

## 2. Configuración y logging estructurado (backend)

- [x] 2.1 Implementar `backend/src/shared/config.ts` que lee `PORT`, `DATABASE_PATH`, `NODE_ENV` desde `process.env` con fail-fast ante variable requerida faltante y verificar con test unitario (Vitest) que arrancar sin variable requerida lanza error descriptivo y no usa default silencioso
- [x] 2.2 Implementar `backend/src/shared/logger.ts` (salida JSON estructurada, inyectable) y verificar con test que las entradas no contienen PHI (nombres/DNI/teléfonos/historia clínica) ni secretos/tokens ni payloads completos
- [x] 2.3 Ampliar `backend/.env.example` con los nombres de variables de config y valores de ejemplo no secretos, y verificar por inspección que no contiene credenciales ni tokens reales (R15)

## 3. Base de datos y runner de migraciones

- [x] 3.1 Introducir en `backend/src/shared/migrations.ts`/`repository.ts` un registro ordenado de migraciones y `runMigrations(db)` idempotente (PRAGMA `foreign_keys=ON`, `journal_mode=WAL`, control `schema_migrations`) formalizando la migración base 001, y verificar con test de SQLite real que una base nueva aplica 001 y que re-ejecutar no falla ni duplica tablas
- [x] 3.2 Hacer que `openDatabase`/`applyMigration003` deleguen en el runner preservando su comportamiento 001→003, y verificar con `npm test` en `backend/` que `crear_turno.test.ts` sigue verde sin modificarlo

## 4. Errores centralizados y bootstrap del servidor

- [x] 4.1 Implementar `AppError` base + middleware centralizado de errores y hacer que `CrearTurnoError` lo extienda sin cambiar su forma (status/eje/ids opacos), verificando con test que un error conocido mapea a su `4xx` JSON y que un error no controlado responde `500 {"error":"interno"}` sin stack, rutas internas, SQL ni PHI
- [x] 4.2 Implementar `backend/src/shared/server.ts` (listen sobre `PORT` + graceful shutdown `SIGINT`/`SIGTERM` cerrando HTTP y DB) sin cambiar la firma de `createApp(db)`, y verificar que `GET /api/health` responde `200 {"status":"ok"}` con test de supertest

## 5. Scripts de dev, CI mínimo y runners de test (backend)

- [x] 5.1 Ajustar `backend/package.json` (script `dev` que levanta el servidor con watch, `engines.node`, script `ci`) y verificar que `npm run typecheck`, `npm test` y `npm run build` pasan en `backend/`
- [x] 5.2 Definir el CI mínimo (workflow GitHub Actions con jobs backend y, luego, frontend: `npm ci` → `typecheck` → `test`) y verificar que el archivo de workflow parsea y referencia los scripts existentes
- [x] 5.3 Documentar en `backend/README.md` los comandos autoritativos (install/typecheck/test/build/dev) y verificar que cada comando documentado corre tal como está escrito (KB-08 §5)

## 6. Scaffolding del frontend React + Vite + TypeScript

- [x] 6.1 Crear la estructura `frontend/` (`package.json` con `"type":"module"`, deps `react`/`react-dom`, devDeps `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/*`, `eslint`; `index.html`, `src/main.tsx`, `src/App.tsx`, `src/components/`, `.gitignore`) y verificar que `npm install` y `npm run dev` levantan el servidor de desarrollo local
- [x] 6.2 Configurar `vite.config.ts`, `tsconfig.json`/`tsconfig.node.json` estrictos y `src/vite-env.d.ts` (tipando `ImportMetaEnv` con `VITE_*`), y verificar que `npm run typecheck` pasa sin `any` injustificado (R10)
- [x] 6.3 Configurar oxlint y Vitest (config compartida vía `defineConfig`) con un test smoke de componente y verificar que `npm run lint` y `npm test` pasan
- [x] 6.4 Verificar que `npm run build` genera los assets estáticos de producción sin errores y que `npm run preview` los sirve
- [x] 6.5 Crear `frontend/.env.example` con solo variables `VITE_*` (p. ej. `VITE_API_BASE_URL`) sin secretos y verificar por inspección que no expone credenciales al navegador

## 7. Cierre documental y verificación de integración (APPLY-time)

- [x] 7.1 Actualizar `CHANGES.md`: marcar **C-01 `[x]`** y **C-04 `[x]`** (corrección factual: C-04 ya está archivado) y verificar por inspección del archivo que ambos quedan en `[x]`
- [x] 7.2 Reflejar "Frontend: React + Vite + TypeScript" en `AGENTS.md` y `CLAUDE.md` (reemplazando "No definido aún") y verificar que ambos archivos declaran el mismo stack frontend
- [x] 7.3 Reflejar la decisión de frontend React + Vite + TypeScript en `knowledge-base/09-decisiones.md` y verificar que la decisión queda trazada sin contradiccir R7
- [x] 7.4 Verificación de integración: correr `npm run typecheck` + `npm test` en `backend/` (incluyendo `crear_turno.test.ts` intacto) y `npm run typecheck` + `npm test` + `npm run build` en `frontend/`, confirmando todo en verde y que no se agregaron dependencias fuera del MVP (R13)
