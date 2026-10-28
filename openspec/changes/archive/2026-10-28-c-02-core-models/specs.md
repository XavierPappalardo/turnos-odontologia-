# Specs: C-02 core-models

## Escenarios verificables

### Escenario 1: Funcionamiento esperado
**Dado** migraciones aplicadas (001→005)
**Cuando** se crean entidades base con datos válidos
**Entonces** se persisten correctamente con FKs, auditoría y valores por defecto

### Escenario 2: Error de negocio
**Dado** intento de crear Turno con `fin <= inicio`
**Cuando** se aplica la validación/migración
**Entonces** se rechaza por CHECK constraint

### Escenario 3: Borde
**Dado** Prestacion con `duracion_min = 0`
**Cuando** se intenta insertar
**Entonces** se rechaza por CHECK `duracion_min > 0`

### Escenario 4: Integridad monetaria (R2/R5)
**Dado** un pago con monto negativo, fraccionario, moneda distinta de ARS o medio inválido
**Cuando** se intenta insertar
**Entonces** SQLite lo rechaza; los totales se suman en centavos enteros

### Escenario 5: Cobertura (R6)
**Dado** `cobertura_pct` fuera de 0..100 o fraccionario
**Cuando** se inserta un plan
**Entonces** SQLite lo rechaza; 0 y 100 se aceptan

### Escenario 6: Seed
**Dado** el seed mínimo
**Cuando** se ejecuta dos veces
**Entonces** no duplica filas y todos los datos son ficticios

## Criterios de aceptación
- Todas las tablas core existen con restricciones y auditoría
- Índices para solapamiento creados
- `BaseRepository`/`UnitOfWork` implementados
- Seed mínimo idempotente con datos ficticios
- Tests verdes (`tests/core_models.test.ts`)
