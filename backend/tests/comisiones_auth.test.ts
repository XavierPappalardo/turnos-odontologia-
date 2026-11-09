/**
 * Task 1.3: matriz RBAC de comisiones (C-13, design D6; R4).
 * Config/gestión: solo administración — recepción y profesional rechazados.
 * El portal del profesional se resuelve con su propio scoping (tests E2E 7.1/6.1).
 */
import { describe, expect, it } from 'vitest';
import {
  ROLES_COM_CONFIG,
  ROLES_COM_GESTION,
  puedeConfigurarComisiones,
  puedeOperarComisiones,
} from '../src/shared/auth.js';

describe('Matriz RBAC de comisiones (C-13)', () => {
  it('Dado constantes de roles Entonces config y gestión son exclusivas de administración', () => {
    expect(ROLES_COM_CONFIG).toEqual(['administracion']);
    expect(ROLES_COM_GESTION).toEqual(['administracion']);
  });

  it('Dado administracion Cuando configura u opera comisiones Entonces se permite', () => {
    expect(puedeConfigurarComisiones('administracion')).toBe(true);
    expect(puedeOperarComisiones('administracion')).toBe(true);
  });

  it('Dado recepcion Cuando configura u opera comisiones Entonces se rechaza (R4: recepción NO configura comisiones)', () => {
    expect(puedeConfigurarComisiones('recepcion')).toBe(false);
    expect(puedeOperarComisiones('recepcion')).toBe(false);
  });

  it('Dado profesional o sin rol Cuando configura u opera comisiones globales Entonces se rechaza', () => {
    expect(puedeConfigurarComisiones('profesional')).toBe(false);
    expect(puedeOperarComisiones('profesional')).toBe(false);
    expect(puedeConfigurarComisiones(undefined)).toBe(false);
    expect(puedeOperarComisiones(undefined)).toBe(false);
  });
});
