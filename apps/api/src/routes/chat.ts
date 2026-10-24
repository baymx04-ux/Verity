import { Router } from 'express';
import { z } from 'zod';

import type { Logger } from '../config/logger';
import { requireAuth } from '../middleware/auth';
import type { ChatService } from '../services/chat';
import type { AuthRequest } from '../types/auth';

interface ChatRouterOptions {
  chatService: ChatService;
  logger: Logger;
}

const chatStreamSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  question: z.string().trim().min(1, 'Question cannot be empty').max(4000),
});

export function createChatRouter({ chatService, logger }: ChatRouterOptions): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/stream', async (req: AuthRequest, res) => {
    const parsed = chatStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message || 'Invalid request payload',
          details: parsed.error.issues,
        },
      });
      return;
    }

    const controller = new AbortController();
    req.on('close', () => {
      controller.abort();
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await chatService.streamChat({
        user: req.user!,
        conversationId: parsed.data.conversation_id,
        question: parsed.data.question,
        onEvent: writeEvent,
        signal: controller.signal,
      });
    } catch (error) {
      logger.error({ err: error }, 'chat stream handler error');
      if (!res.writableEnded) {
        writeEvent('error', {
          code: 'stream_error',
          message: error instanceof Error ? error.message : 'An error occurred during streaming.',
        });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
