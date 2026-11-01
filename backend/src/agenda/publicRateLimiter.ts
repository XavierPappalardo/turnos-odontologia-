/**
 * Rate limiter de reservas públicas (C-05): por IP del cliente, independiente
 * del rate limiter de login de C-03. Inyectable en tiempo → testeable sin
 * esperas reales. La clave incluye la IP normalizada, pero NUNCA se loguea
 * (R3).
 */
export interface PublicRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface PublicRateLimiterOptions {
  max: number;
  windowSeconds: number;
  now?: () => number;
}

export class PublicRateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, number[]>();

  constructor(options: PublicRateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowSeconds * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /** Registra un intento y devuelve si está permitido. */
  intentar(key: string): PublicRateLimitResult {
    const now = this.now();
    const desde = now - this.windowMs;
    const previos = (this.attempts.get(key) ?? []).filter((t) => t > desde);

    if (previos.length >= this.max) {
      const masViejo = previos[0] ?? now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((masViejo + this.windowMs - now) / 1000),
      );
      this.attempts.set(key, previos);
      return { allowed: false, retryAfterSeconds };
    }

    previos.push(now);
    this.attempts.set(key, previos);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Limpia claves vencidas (llamado oportunísticamente en cada intento). */
  limpiar(): void {
    const desde = this.now() - this.windowMs;
    for (const [key, tiempos] of this.attempts) {
      const vigentes = tiempos.filter((t) => t > desde);
      if (vigentes.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, vigentes);
    }
  }
}

/** Middleware Express que aplica rate limiting por IP a reservas públicas. */
export function publicRateLimiterMiddleware(
  limiter: PublicRateLimiter,
): (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void {
  return (req, res, next) => {
    const ip = req.ip ?? 'desconocida';
    const resultado = limiter.intentar(ip);
    limiter.limpiar();
    if (!resultado.allowed) {
      res.setHeader('Retry-After', String(resultado.retryAfterSeconds));
      res.status(429).json({ error: 'demasiados_intentos', retry_after: resultado.retryAfterSeconds });
      return;
    }
    next();
  };
}
