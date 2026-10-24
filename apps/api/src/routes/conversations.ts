import { Router } from 'express';
import { z } from 'zod';

import type { Logger } from '../config/logger';
import { requireAuth } from '../middleware/auth';
import type { ChatService } from '../services/chat';
import type { AuthRequest } from '../types/auth';

interface ConversationsRouterOptions {
  chatService: ChatService;
  logger: Logger;
}

const createConversationSchema = z.object({
  title: z.string().trim().max(100).optional(),
});

export function createConversationsRouter({ chatService, logger }: ConversationsRouterOptions): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req: AuthRequest, res, next) => {
    try {
      const conversations = await chatService.listConversations(req.user!.id);
      res.json({ conversations });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req: AuthRequest, res, next) => {
    try {
      const parsed = createConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message: 'Invalid conversation payload',
            details: parsed.error.issues,
          },
        });
        return;
      }

      const conversation = await chatService.createConversation(req.user!.id, parsed.data.title);
      logger.debug({ conversationId: conversation.id }, 'conversation created');
      res.status(201).json({ conversation });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/messages', async (req: AuthRequest, res, next) => {
    try {
      const conversationId = req.params.id!;
      const messages = await chatService.listMessages(req.user!.id, conversationId);
      res.json({ messages });
    } catch (error) {
      if (error instanceof Error && error.message === 'Conversation not found') {
        res.status(404).json({
          error: {
            code: 'not_found',
            message: 'Conversation not found',
          },
        });
        return;
      }
      next(error);
    }
  });

  router.delete('/:id', async (req: AuthRequest, res, next) => {
    try {
      const conversationId = req.params.id!;
      const deleted = await chatService.deleteConversation(req.user!.id, conversationId);
      if (!deleted) {
        res.status(404).json({
          error: {
            code: 'not_found',
            message: 'Conversation not found',
          },
        });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
