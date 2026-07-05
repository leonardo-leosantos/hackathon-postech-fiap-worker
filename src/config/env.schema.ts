import { z } from 'zod';

/**
 * Schema de validação das variáveis de ambiente do Video Worker.
 * Todas as variáveis obrigatórias precisam estar presentes e não vazias,
 * caso contrário a aplicação falha no boot (fail-fast).
 */
export const envSchema = z.object({
  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),
  SQS_QUEUE_URL: z.string().url('SQS_QUEUE_URL must be a valid URL'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
  API_URL: z.string().url('API_URL must be a valid URL'),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

/** Tipo inferido com as variáveis de ambiente já validadas e tipadas. */
export type EnvVars = z.infer<typeof envSchema>;

/**
 * Valida o objeto de configuração bruto (process.env) contra o schema.
 * Usado como `validate` do `@nestjs/config`.
 *
 * @throws Error com a lista de variáveis ausentes/inválidas caso a validação falhe.
 */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
