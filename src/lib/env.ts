import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at first import. Missing optional
 * integrations (OpenAI, S3) are allowed; their features report themselves as
 * "not configured" rather than pretending to work.
 */
const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    APPLICATION_URL: z.url(),
    ENCRYPTION_KEY: base64Key32,
    OPENAI_API_KEY: optionalString,
    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./.storage"),
    STORAGE_BUCKET: optionalString,
    STORAGE_REGION: optionalString,
    STORAGE_ACCESS_KEY: optionalString,
    STORAGE_SECRET_KEY: optionalString,
    STORAGE_ENDPOINT: optionalString,
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(1_000_000_000).default(50 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_PROVIDER === "s3") {
      for (const key of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when STORAGE_PROVIDER=s3" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Names only — never echo values.
    throw new Error(`Invalid environment configuration:\n${details}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env: Env = load();
