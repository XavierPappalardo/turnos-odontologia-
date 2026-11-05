/**
 * Errores del módulo de obras sociales (C-12).
 * Sin PHI (R3), estatus HTTP exactos y tipados (R10).
 */
import { AppError } from '../shared/errors.js';

export class ObraSocialError extends AppError {
  constructor(args: { status: number; code: string; message: string }) {
    super(args);
    this.name = 'ObraSocialError';
  }
}

export class ObraSocialValidacionError extends ObraSocialError {
  constructor(message: string, code = 'validacion') {
    super({ status: 400, code, message });
    this.name = 'ObraSocialValidacionError';
  }
}

export class ObraSocialForbiddenError extends ObraSocialError {
  constructor(message = 'Acceso denegado', code = 'forbidden') {
    super({ status: 403, code, message });
    this.name = 'ObraSocialForbiddenError';
  }
}

export class ObraSocialNotFoundError extends ObraSocialError {
  constructor(message = 'Recurso no encontrado', code = 'not_found') {
    super({ status: 404, code, message });
    this.name = 'ObraSocialNotFoundError';
  }
}

export class ObraSocialConflictoError extends ObraSocialError {
  constructor(message: string, code = 'conflicto') {
    super({ status: 409, code, message });
    this.name = 'ObraSocialConflictoError';
  }
}
