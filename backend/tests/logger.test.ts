/**
 * Logger estructurado sin PHI ni secretos (spec platform/foundation: logging;
 * design D3; R3). Inyectable (sink) → sin estado global mutable (skill vitest).
 */
import { describe, expect, it } from 'vitest';
import { createLogger, type LogLevel } from '../src/shared/logger.js';

interface Collected {
  readonly lines: string[];
  readonly levels: LogLevel[];
  readonly sink: (line: string, level: LogLevel) => void;
}

function collector(): Collected {
  const lines: string[] = [];
  const levels: LogLevel[] = [];
  return {
    lines,
    levels,
    sink: (line, level) => {
      lines.push(line);
      levels.push(level);
    },
  };
}

describe('createLogger', () => {
  it('Dado un evento Cuando logueo Entonces emite una línea JSON con level/msg/context/timestamp', () => {
    const c = collector();
    const log = createLogger(c.sink);
    log.info('turno creado', { turnoId: 'uuid-opaco-123' });

    expect(c.lines).toHaveLength(1);
    expect(c.levels).toEqual(['info']);
    const entry = JSON.parse(c.lines[0]) as {
      level: string;
      msg: string;
      timestamp: string;
      context: Record<string, unknown>;
    };
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('turno creado');
    expect(entry.context['turnoId']).toBe('uuid-opaco-123');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('Dado contexto con PHI y secretos Cuando logueo Entonces los redacta (R3/R15)', () => {
    const c = collector();
    const log = createLogger(c.sink);
    log.error('fallo de creacion', {
      nombre: 'Paciente Ficticio Ejemplo',
      apellido: 'Apellido Ficticio',
      dni: '12345678',
      telefono: '+5491100000000',
      telefono_whatsapp: '+5491100000001',
      historia_clinica: 'HC-999',
      email: 'ficticio@example.test',
      token: 'secreto-token-abc',
      password: 'hunter2',
      authorization: 'Bearer abc.def.ghi',
    });

    const raw = c.lines.join('\n');
    expect(raw).not.toMatch(
      /Ficticio|12345678|5491100000000|5491100000001|HC-999|ficticio@example\.test|secreto-token-abc|hunter2|abc\.def\.ghi/,
    );
    const entry = JSON.parse(c.lines[0]) as { context: Record<string, unknown> };
    expect(entry.context['nombre']).toBe('[REDACTED]');
    expect(entry.context['dni']).toBe('[REDACTED]');
    expect(entry.context['telefono']).toBe('[REDACTED]');
    expect(entry.context['token']).toBe('[REDACTED]');
  });

  it('Dado payload completo Cuando logueo Entonces lo redacta sin volcarlo', () => {
    const c = collector();
    const log = createLogger(c.sink);
    log.info('request', {
      body: { nombre: 'Paciente Ficticio', dni: '12345678' },
      payload: { token: 'x' },
    });
    const entry = JSON.parse(c.lines[0]) as { context: Record<string, unknown> };
    expect(entry.context['body']).toBe('[REDACTED]');
    expect(entry.context['payload']).toBe('[REDACTED]');
    expect(c.lines.join('\n')).not.toMatch(/Ficticio|12345678/);
  });

  it('Dado contexto anidado profundo Cuando logueo Entonces trunca la profundidad', () => {
    const c = collector();
    const log = createLogger(c.sink);
    log.info('deep', { a: { b: { c: { d: { e: { f: 'muy profundo' } } } } } });
    const raw = c.lines.join('\n');
    expect(raw).not.toContain('muy profundo');
  });

  it('Dado nivel error Cuando logueo Entonces propaga el nivel al sink', () => {
    const c = collector();
    const log = createLogger(c.sink);
    log.warn('algo');
    log.error('peor');
    expect(c.levels).toEqual(['warn', 'error']);
  });
});
