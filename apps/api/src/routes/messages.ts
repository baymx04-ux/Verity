import { Router } from 'express';
import { z } from 'zod';

import type { Logger } from '../config/logger';
import { requireAuth } from '../middleware/auth';
import type { ChatService } from '../services/chat';
import type { AuthRequest } from '../types/auth';

interface MessagesRouterOptions {
  chatService: ChatService;
  logger: Logger;
}

const feedbackSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(2000).optional(),
});

export function createMessagesRouter({ chatService, logger }: MessagesRouterOptions): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/:id/feedback', async (req: AuthRequest, res, next) => {
    try {
      const parsed = feedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message: 'Feedback rating must be 1 or -1',
            details: parsed.error.issues,
          },
        });
        return;
      }

      const messageId = req.params.id!;
      const feedback = await chatService.submitFeedback(
        req.user!.id,
        messageId,
        parsed.data.rating,
        parsed.data.comment,
      );
      logger.debug({ messageId, rating: parsed.data.rating }, 'feedback recorded');

      res.json({ feedback });
    } catch (error) {
      if (error instanceof Error && error.message === 'Message not found') {
        res.status(404).json({
          error: {
            code: 'not_found',
            message: 'Message not found',
          },
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
