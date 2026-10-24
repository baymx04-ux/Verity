import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import type { DocumentService } from '../services/documents';
import type { AuthRequest } from '../types/auth';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadRateLimiter } from '../middleware/rate-limit';

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'markdown', 'html', 'htm'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
  'application/xhtml+xml',
  'application/octet-stream',
];

export interface DocumentRouterDeps {
  documentService: DocumentService;
  config: AppConfig;
  logger: Logger;
}

export function createDocumentRouter({ documentService, config, logger }: DocumentRouterDeps) {
  const router = Router();
  const requireAuth = authenticate(config, logger);
  const uploadLimiter = uploadRateLimiter(config.UPLOAD_RATE_LIMIT_PER_HOUR);
  const maxUploadMb = config.UPLOAD_MAX_MB;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Extension AND declared MIME are checked here; the AI parser is the final
      // authority and rejects anything that does not actually parse.
      const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        cb(new Error('Unsupported file type. Supported types: PDF, DOCX, TXT, MD, HTML.'));
        return;
      }
      if (file.mimetype && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(new Error('The declared file type does not match a supported document type.'));
        return;
      }
      cb(null, true);
    },
  });

  function receiveUpload(req: AuthRequest, res: Response, next: NextFunction): void {
    upload.single('file')(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: {
            code: 'file_too_large',
            message: `The file exceeds the ${maxUploadMb} MB upload limit.`,
          },
        });
        return;
      }

      res.status(400).json({
        error: {
          code: 'invalid_file',
          message:
            error instanceof Error ? error.message : 'The uploaded file could not be accepted.',
        },
      });
    });
  }

  router.post(
    '/',
    requireAuth,
    requireRole(['admin', 'analyst']),
    uploadLimiter,
    receiveUpload,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: { code: 'no_file', message: 'No file uploaded' } });
          return;
        }

        const schema = z.object({
          title: z.string().min(1).max(500).optional(),
          access_level: z.enum(['public', 'internal', 'restricted']).default('internal'),
          group_ids: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
        });

        const parsed = schema.safeParse({
          ...req.body,
          group_ids: req.body?.group_ids ?? req.body?.groups,
        });

        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'validation_error',
              message: 'Invalid document upload metadata',
              details: parsed.error.issues,
            },
          });
          return;
        }

        const accessLevel = req.user!.role === 'analyst' ? 'internal' : parsed.data.access_level;

        const groupIds =
          typeof parsed.data.group_ids === 'string'
            ? [parsed.data.group_ids]
            : parsed.data.group_ids;

        const doc = await documentService.create({
          ownerId: req.user!.id,
          title: parsed.data.title ?? req.file.originalname,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          buffer: req.file.buffer,
          accessLevel,
          ...(groupIds ? { groupIds } : {}),
        });

        res.status(201).json({ document: doc });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await documentService.list(req.user!, {
        ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}),
        ...(typeof req.query.access_level === 'string'
          ? { accessLevel: req.query.access_level }
          : {}),
        ...(typeof req.query.search === 'string' && req.query.search.length > 0
          ? { search: req.query.search }
          : {}),
        page: req.query.page ? Number.parseInt(String(req.query.page), 10) : 1,
        limit: req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 20,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const doc = await documentService.getById(String(req.params.id), req.user!);
      if (!doc) {
        res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
        return;
      }
      res.json({ document: doc });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/file', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const url = await documentService.getDownloadUrl(String(req.params.id), req.user!);
      if (!url) {
        res
          .status(404)
          .json({ error: { code: 'not_found', message: 'Document not found or access denied' } });
        return;
      }
      res.json({ url, expires_in_s: 300 });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/:id/retry',
    requireAuth,
    requireRole(['admin', 'analyst']),
    async (req: AuthRequest, res, next) => {
      try {
        const updated = await documentService.retry(String(req.params.id), req.user!);
        if (!updated) {
          res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
          return;
        }
        res.json({ document: updated });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch('/:id', requireAuth, requireRole(['admin']), async (req, res, next) => {
    try {
      const schema = z.object({
        title: z.string().min(1).max(500).optional(),
        access_level: z.enum(['public', 'internal', 'restricted']).optional(),
        group_ids: z.array(z.string().uuid()).optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'validation_error',
            message: 'Invalid update payload',
            details: parsed.error.issues,
          },
        });
        return;
      }

      const updated = await documentService.update(String(req.params.id), {
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        ...(parsed.data.access_level ? { access_level: parsed.data.access_level } : {}),
        ...(parsed.data.group_ids ? { group_ids: parsed.data.group_ids } : {}),
      });
      if (!updated) {
        res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
        return;
      }

      res.json({ document: updated });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', requireAuth, requireRole(['admin']), async (req, res, next) => {
    try {
      const deleted = await documentService.delete(String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
        return;
      }
      res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
