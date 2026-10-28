/**
 * Rate limiter de login en memoria (C-03: 5/60s por IP+email).
 * Inyectable en tiempo → testeable sin esperas reales. La clave incluye email
 * normalizado, pero NUNCA se loguea.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  max: number;
  windowSeconds: number;
  now?: () => number;
}

export class LoginRateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, number[]>();

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowSeconds * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /** Registra un intento y devuelve si está permitido. */
  intentar(key: string): RateLimitResult {
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
