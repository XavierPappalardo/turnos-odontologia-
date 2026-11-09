import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalPaciente } from './PortalPaciente';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PortalPaciente (C-17, 5.1)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Dado acceso sin token Cuando se renderiza Entonces muestra formulario de ingreso y secciones tras ingresar', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/portal/turnos')) return jsonResponse(200, { turnos: [] });
      if (url.endsWith('/portal/presupuestos')) return jsonResponse(200, { presupuestos: [] });
      if (url.endsWith('/portal/documentos')) return jsonResponse(200, { documentos: [] });
      return jsonResponse(404, { error: 'not_found' });
    });

    render(<PortalPaciente />);
    expect(screen.getByRole('heading', { name: /portal del paciente/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/enlace o token/i), { target: { value: 'token-ficticio' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /mis turnos/i })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /mis presupuestos/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /documentos/i })).toBeInTheDocument();
    expect(screen.getByText(/no hay documentos disponibles/i)).toBeInTheDocument();
  });

  it('Dado token en hash de URL Cuando carga Entonces consume API y limpia token de la URL', async () => {
    window.history.replaceState({}, '', '/#token=abc123');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/portal/')) return jsonResponse(200, { turnos: [], presupuestos: [], documentos: [] });
      return jsonResponse(404, { error: 'not_found' });
    });

    render(<PortalPaciente />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(window.location.hash).toBe('');
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('abc123'), expect.anything());
  });

  it('Dado error de autenticación Cuando consulta Entonces muestra mensaje seguro sin datos sensibles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, { error: 'credenciales_invalidas', message: 'acceso inválido' }),
    );
    window.history.replaceState({}, '', '/#token=invalido');

    render(<PortalPaciente />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').not.toMatch(/credenciales_invalidas|stack|secret|token_hash/i);
    expect(alert).toHaveTextContent(/no es válido|expir|error|no se pudo/i);
  });

  it('Dado turno propio reservado Cuando confirma Entonces llama endpoint y refresca', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/portal/turnos') && !url.includes('/confirmar')) {
        const after = calls.some((c) => c.includes('/confirmar'));
        return jsonResponse(200, { turnos: [{ id: 't-1', profesional_id: 'p', sillon_id: 's', prestacion_id: null, inicio: '2026-11-15T10:00:00.000Z', fin: '2026-11-15T10:30:00.000Z', estado: after ? 'confirmado' : 'reservado', origen: 'recepcion' }] });
      }
      if (url.endsWith('/portal/presupuestos')) return jsonResponse(200, { presupuestos: [] });
      if (url.endsWith('/portal/documentos')) return jsonResponse(200, { documentos: [] });
      if (url.endsWith('/portal/turnos/t-1/confirmar')) return jsonResponse(200, { estado: 'confirmado' });
      return jsonResponse(404, { error: 'not_found' });
    });
    window.history.replaceState({}, '', '/#token=tok');

    render(<PortalPaciente />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^confirmar$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^confirmar$/i }));
    await waitFor(() => expect(calls.some((c) => c.includes('POST') && c.includes('/confirmar'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/turno confirmado/i));
  });
});
