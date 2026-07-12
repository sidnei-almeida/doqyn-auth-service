import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4100),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default('doqyn_session'),
  SESSION_TTL_DAYS: z.coerce.number().default(7),
  COOKIE_DOMAIN: z.string().optional().default(''),
  COOKIE_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  DOQYN_INTERNAL_API_KEY: z.string().min(1),
  DOQYN_APP_BASE_URL: z.string().default('http://127.0.0.1:3001'),
  // Sem default fraco — em production exige chave explícita e forte.
  DOQYN_APP_INTERNAL_API_KEY: z.string().min(1).optional().default(''),
  DATA_ENCRYPTION_KEY: z.string().min(1),
  LOOKUP_HASH_SECRET: z.string().min(1),
  SESSION_TOKEN_HASH_SECRET: z.string().min(1),
  PASSWORD_RESET_TOKEN_HASH_SECRET: z.string().min(1),
  PASSWORD_PEPPER: z.string().optional().default(''),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().default(24),
  OAUTH_GOOGLE_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional().default(''),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH_GOOGLE_REDIRECT_URI: z
    .string()
    .optional()
    .default('http://127.0.0.1:4100/oauth/google/callback'),
  OAUTH_MICROSOFT_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  OAUTH_MICROSOFT_CLIENT_ID: z.string().optional().default(''),
  OAUTH_MICROSOFT_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH_MICROSOFT_TENANT: z.string().optional().default('common'),
  OAUTH_MICROSOFT_REDIRECT_URI: z
    .string()
    .optional()
    .default('http://127.0.0.1:4100/oauth/microsoft/callback'),
  OAUTH_POST_LOGIN_REDIRECT_URL: z
    .string()
    .optional()
    .default('http://localhost:5173/auth/oauth/callback'),
  OAUTH_ERROR_REDIRECT_URL: z.string().optional().default('http://localhost:5173/login'),
  DOQYN_APP_PUBLIC_URL: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('noreply@doqyn.com.br'),
  EMAIL_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  INVITE_TTL_DAYS: z.coerce.number().default(7),
  EMAIL_CHANGE_TTL_HOURS: z.coerce.number().default(24),
  EMAIL_CHANGE_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  DATABASE_URL_DIRECT: z.string().optional().default(''),
  REDIS_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  REDIS_URL: z.string().optional().default(''),
  REDIS_KEY_PREFIX: z.string().optional().default('doqyn:'),
  RATE_LIMIT_REDIS_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v === 'true'),
}).transform((data) => ({
  ...data,
  DATABASE_URL_DIRECT: data.DATABASE_URL_DIRECT?.trim() || data.DATABASE_URL,
}));

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

const WEAK_APP_INTERNAL_KEYS = new Set([
  '',
  'dev-app-internal-api-key-change-in-production',
  'change-me',
  'changeme',
]);

export function loadEnv(overrides?: Record<string, string>): Env {
  if (cachedEnv && !overrides) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }

  const data = parsed.data;
  const appKey = data.DOQYN_APP_INTERNAL_API_KEY?.trim() ?? '';

  if (data.NODE_ENV === 'production') {
    if (WEAK_APP_INTERNAL_KEYS.has(appKey) || appKey.length < 24) {
      throw new Error(
        'DOQYN_APP_INTERNAL_API_KEY inválida em production: defina uma chave forte (≥24 chars) sem o valor de desenvolvimento.',
      );
    }
  } else if (!appKey) {
    // Dev/test: fallback explícito e óbvio (nunca em production).
    (data as { DOQYN_APP_INTERNAL_API_KEY: string }).DOQYN_APP_INTERNAL_API_KEY =
      'dev-app-internal-api-key-change-in-production';
  }

  if (!overrides) {
    cachedEnv = data;
  }

  return data;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function getAllowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

export function getPublicAppBaseUrl(env: Env): string {
  const explicit = env.DOQYN_APP_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const origins = getAllowedOrigins(env);
  return (origins[0] ?? 'http://localhost:5173').replace(/\/$/, '');
}
