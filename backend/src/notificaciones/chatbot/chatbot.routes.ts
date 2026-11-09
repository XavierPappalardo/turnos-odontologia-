/**
 * Ruta pública simulada del chatbot WhatsApp (C-16). Sin auth JWT, sin credenciales reales.
 * Rate limiting por IP. Respuestas/logs sin PHI (R1/R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../shared/config.js';
import { PublicRateLimiter, publicRateLimiterMiddleware } from '../../agenda/publicRateLimiter.js';
import { SimulatedWhatsAppAdapter } from './whatsapp.adapter.js';
import { procesarMensajeChatbot } from './chatbot.service.js';

export function chatbotRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const limiter = new PublicRateLimiter({
    max: config.chatbot.rateMax,
    windowSeconds: config.chatbot.rateWindowSeconds,
  });
  router.use(publicRateLimiterMiddleware(limiter));

  const adapter = new SimulatedWhatsAppAdapter();

  router.post('/chatbot/whatsapp/simulado', (req: Request, res: Response, next: NextFunction) => {
    try {
      const inbound = adapter.normalizeInbound(req.body);
      const out = procesarMensajeChatbot(db, inbound, config);
      adapter.send(out);
      // Log operativo sin PHI (R3): solo conversation_id opaco y código.
      // eslint-disable-next-line no-console
      console.log(`chatbot conversation_id=${inbound.conversationId} code=${out.code ?? 'ok'}`);
      res.status(200).json(out);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
