# language: es
Característica: Crear un turno evitando solapamientos por profesional y por sillón/box
  Como recepción
  Quiero crear turnos internos validando doble eje (profesional AND sillón) y bloqueos
  Para no generar dobles reservas en la agenda

  Antecedentes:
    Dado que existen el profesional "P1", el sillón "S1" y el paciente ficticio "Paciente Ejemplo"

  Escenario: feliz — profesional y sillón libres devuelven 201 reservado
    Dado que el profesional "P1" y el sillón "S1" están libres de 10:00 a 10:30
    Cuando envío POST /api/turnos con profesional "P1", sillón "S1", inicio 10:00 y fin 10:30
    Entonces recibo 201 y el turno queda en estado "reservado"

  Escenario: error de negocio — solape por profesional devuelve 409
    Dado que existe un turno activo del profesional "P1" de 10:00 a 10:30
    Cuando envío POST /api/turnos con profesional "P1", otro sillón, inicio 10:15 y fin 10:45
    Entonces recibo 409 con eje "profesional" y el turno no se persiste

  Escenario: error de negocio — solape por sillón devuelve 409
    Dado que existe un turno activo en el sillón "S1" de 10:00 a 10:30 con otro profesional
    Cuando envío POST /api/turnos con sillón "S1", inicio 10:15 y fin 10:45
    Entonces recibo 409 con eje "sillon" y el turno no se persiste

  Escenario: borde contiguo — fin igual a inicio devuelve 201
    Dado que existe un turno activo de 10:00 a 10:30 con el profesional "P1" y el sillón "S1"
    Cuando envío POST /api/turnos con profesional "P1", sillón "S1", inicio 10:30 y fin 11:00
    Entonces recibo 201 y el turno queda en estado "reservado"

  Escenario: bloqueo aplicable — reserva intersectada devuelve 409
    Dado que existe un bloqueo aplicable al profesional "P1" de 10:00 a 12:00
    Cuando envío POST /api/turnos con profesional "P1", inicio 11:00 y fin 11:30
    Entonces recibo 409 con eje "bloqueo" y el turno no se persiste

  Escenario: estado que libera — hueco cancelado devuelve 201
    Dado que existe un turno "cancelado" de 10:00 a 10:30 con el profesional "P1" y el sillón "S1"
    Cuando envío POST /api/turnos con profesional "P1", sillón "S1", inicio 10:00 y fin 10:30
    Entonces recibo 201 y el turno queda en estado "reservado"

  Escenario: validación — fin anterior a inicio devuelve 400
    Cuando envío POST /api/turnos con inicio 11:00 y fin 10:30
    Entonces recibo 400 y el turno no se persiste

  Escenario: concurrencia — doble escritura concurrente deja un solo turno
    Dado que el profesional "P1" y el sillón "S1" están libres de 10:00 a 10:30
    Cuando dos solicitudes concurrentes crean el mismo hueco con "P1" y "S1"
    Entonces una recibe 201 y la otra 409, y persiste un único turno activo
