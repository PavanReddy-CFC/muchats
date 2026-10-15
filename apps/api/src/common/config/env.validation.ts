import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default('*'),
  // Set when the API is reverse-proxied behind a path prefix (e.g. an ALB rule forwarding
  // /chat-api/* to this service alongside other apps on the same host) — applied to both REST
  // routes (Nest global prefix) and the Socket.IO handshake path in main.ts. Leave unset for
  // local dev / a dedicated subdomain, where the API is served at the root path.
  API_PREFIX: z.string().optional(),
  // Optional: only required to use the image-attachment upload endpoints. Left unset, those
  // endpoints throw a clear 500 rather than the whole API failing to boot.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(), // set for R2 / any S3-compatible non-AWS endpoint
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Optional: only required to use push notifications (admin "set Firebase config" endpoint
  // and the send pipeline). Protects the *storage* of each tenant's Firebase service-account
  // JSON at rest — the Firebase credentials themselves are configured per tenant, not here.
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  PUSH_CONFIG_ENCRYPTION_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.toString()}`);
  }
  return parsed.data;
}
