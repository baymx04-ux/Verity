import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().min(1).default('verity'),
  VERITY_APP_USER: z.string().min(1),
  VERITY_APP_PASSWORD: z.string().min(1),

  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MINIO_BUCKET: z.string().min(1).default('verity-docs'),
  MINIO_ACCESS_KEY: z.string().default('verity-minio'),
  MINIO_SECRET_KEY: z.string().default('change-me-minio'),
  MINIO_PUBLIC_ENDPOINT: z.string().default('http://localhost:9000'),

  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  INTERNAL_SERVICE_TOKEN: z.string().min(1).optional(),

  LLM_PROVIDER: z.enum(['google', 'anthropic', 'openai', 'ollama']).default('google'),
  LLM_MODEL: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().default('google'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  RERANKER: z.enum(['cohere', 'local', 'none', 'google']).default('none'),
  COHERE_API_KEY: z.string().optional(),

  // USD per one million tokens. Leave at 0 when you do not want cost estimates;
  // the dashboard labels these values as estimates and never implies billing.
  LLM_INPUT_COST_PER_MILLION: z.coerce.number().min(0).default(0),
  LLM_OUTPUT_COST_PER_MILLION: z.coerce.number().min(0).default(0),

  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
  UPLOAD_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32).default('change-me-access-secret-at-least-32-chars'),
  JWT_REFRESH_SECRET: z.string().min(32).default('change-me-refresh-secret-at-least-32-chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  JWT_ISSUER: z.string().default('verity'),
  JWT_AUDIENCE: z.string().default('verity-api'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  CHAT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
});

export type AppConfig = z.infer<typeof envSchema> & {
  databaseUrl: string;
  minioUrl: string;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const values = parsed.data;
  const protocol = values.MINIO_USE_SSL ? 'https' : 'http';
  const databaseUrl = `postgresql://${encodeURIComponent(values.VERITY_APP_USER)}:${encodeURIComponent(
    values.VERITY_APP_PASSWORD,
  )}@${values.POSTGRES_HOST}:${values.POSTGRES_PORT}/${values.POSTGRES_DB}`;

  return {
    ...values,
    databaseUrl,
    minioUrl: `${protocol}://${values.MINIO_ENDPOINT}:${values.MINIO_PORT}`,
    isProduction: values.NODE_ENV === 'production',
  };
}
