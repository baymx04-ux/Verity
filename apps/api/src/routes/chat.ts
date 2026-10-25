import { Router } from 'express';
import { z } from 'zod';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import { requireAuth } from '../middleware/auth';
import { chatRateLimiter } from '../middleware/rate-limit';
import type { ChatService } from '../services/chat';
import type { AuthRequest } from '../types/auth';

interface ChatRouterOptions {
  chatService: ChatService;
  logger: Logger;
  config: AppConfig;
}

const chatStreamSchema = z
  .object({
    conversation_id: z.string().uuid().optional(),
    question: z.string().trim().min(1, 'Question cannot be empty').max(4000).optional(),
    regenerate: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.regenerate) {
      if (!value.conversation_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conversation_id'],
          message: 'A conversation is required to regenerate an answer',
        });
      }
      return;
    }

    if (!value.question) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['question'],
        message: 'Question cannot be empty',
      });
    }
  });

const HEARTBEAT_MS = 15_000;

export function createChatRouter({ chatService, logger, config }: ChatRouterOptions): Router {
  const router = Router();
  const limiter = chatRateLimiter(config.CHAT_RATE_LIMIT_PER_MIN);

  router.use(requireAuth);

  router.post('/stream', limiter, async (req: AuthRequest, res) => {
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
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      if (res.writableEnded || controller.signal.aborted) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Keep intermediaries from closing an idle generation stream. Comments are
    // valid SSE and are ignored by the client parser.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !controller.signal.aborted) {
        res.write(': ping\n\n');
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      await chatService.streamChat({
        user: req.user!,
        ...(parsed.data.conversation_id ? { conversationId: parsed.data.conversation_id } : {}),
        ...(parsed.data.question ? { question: parsed.data.question } : {}),
        ...(parsed.data.regenerate ? { regenerate: true } : {}),
        onEvent: writeEvent,
        signal: controller.signal,
      });
    } catch (error) {
      logger.error({ err: error }, 'chat stream handler error');
      if (!res.writableEnded && !controller.signal.aborted) {
        const message =
          error instanceof Error && error.message === 'Conversation not found'
            ? 'Conversation not found'
            : error instanceof Error &&
                (error.message === 'A question is required.' ||
                  error.message === 'There is no earlier question to regenerate.' ||
                  error.message === 'A conversation is required to regenerate an answer.')
              ? error.message
              : 'The answer could not be generated. Please try again.';

        if (message === 'Conversation not found') {
          // Headers are already committed to SSE, so report the error in-band.
          writeEvent('error', { code: 'not_found', message });
        } else {
          writeEvent('error', { code: 'stream_error', message });
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
