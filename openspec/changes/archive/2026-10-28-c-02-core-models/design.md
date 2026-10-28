# Design: C-02 core-models

## Patrones
- BaseRepository[T] + UnitOfWork
- AuditMixin: created_at, updated_at, deleted_at, activo
- SQLite con migraciones gestionadas
- Transacciones BEGIN IMMEDIATE para operaciones críticas (base para C-04)

## Modelo de datos (resumido)
Ver `knowledge-base/04-modelos-datos.md`. Entidades: Profesional, SillonBox, Paciente, Prestacion, Turno, Bloqueo, ObraSocialPlan, Pago.

## Restricciones
- `fin > inicio`, `duracion_min > 0`
- `cobertura_pct` 0-100
- `monto_centavos >= 0`, moneda ARS
- índices: `(profesional_id,inicio,fin)`, `(sillon_id,inicio,fin)`

## Estados Turno
`reservado`, `confirmado`, `presente`, `cancelado`, `ausente`, `atendido` (máquina mínima)

## Consideraciones
- Sin datos reales (R1)
- Usar UUIDs opacos en logs (R3)
- Monetario en centavos (R2,R5)
- Acceso vía repositorios (R8)
