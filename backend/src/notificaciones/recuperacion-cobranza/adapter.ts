/**
 * Adaptador de envío simulado/estructural (C-18). Sin credenciales reales.
 * Nunca incluye PHI en el resultado/registro.
 */
export interface EnvioSimuladoInput {
  tipo: 'recuperacion' | 'cobranza';
  pacienteId: string;
  referenciaOpaca: string;
}

export interface EnvioSimuladoResultado {
  canal: 'simulado';
  estado: 'enviado_simulado';
  referencia: string;
}

export function enviarSimulado(input: EnvioSimuladoInput): EnvioSimuladoResultado {
  return {
    canal: 'simulado',
    estado: 'enviado_simulado',
    referencia: `sim:${input.tipo}:${input.referenciaOpaca}`,
  };
}
