/**
 * Adaptador de envío simulado/estructural (C-19). Sin credenciales reales.
 * Nunca incluye PHI en el resultado/registro.
 */
export interface EnvioResenaSimuladoInput {
  turnoId: string;
  pacienteId: string;
  canal: 'whatsapp' | 'email';
  referenciaOpaca: string;
}

export interface EnvioResenaSimuladoResultado {
  canal: 'whatsapp' | 'email';
  estado: 'enviado_simulado';
  referencia: string;
}

export function enviarSolicitudResenaSimulada(
  input: EnvioResenaSimuladoInput,
): EnvioResenaSimuladoResultado {
  return {
    canal: input.canal,
    estado: 'enviado_simulado',
    referencia: `sim:resena:${input.referenciaOpaca}`,
  };
}
