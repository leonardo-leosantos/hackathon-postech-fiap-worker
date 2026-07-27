import { validateEnv } from './env.schema';

const validEnv = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  SQS_QUEUE_URL: 'http://localhost:4566/000000000000/video-processing',
  S3_BUCKET_NAME: 'hackathon-videos',
  API_URL: 'http://localhost:3000',
  INTERNAL_API_TOKEN: 'internal-token',
};

describe('validateEnv', () => {
  it('config válido: retorna as variáveis tipadas', () => {
    const env = validateEnv({
      ...validEnv,
      AWS_ENDPOINT: 'http://localhost:4566',
    });

    expect(env.AWS_REGION).toBe('us-east-1');
    expect(env.AWS_ENDPOINT).toBe('http://localhost:4566');
  });

  it('aplica os defaults de PORT e NODE_ENV e coage PORT para número', () => {
    const env = validateEnv(validEnv);

    expect(env).toMatchObject({ PORT: 3001, NODE_ENV: 'development' });
    // Opcional ausente continua ausente: em produção o SDK usa a AWS real.
    expect(env.AWS_ENDPOINT).toBeUndefined();
    expect(validateEnv({ ...validEnv, PORT: '4001' }).PORT).toBe(4001);
  });

  it('AWS_SESSION_TOKEN é opcional: aceito quando presente, ausente sem quebrar o boot', () => {
    expect(
      validateEnv({ ...validEnv, AWS_SESSION_TOKEN: 'academy-session-token' })
        .AWS_SESSION_TOKEN,
    ).toBe('academy-session-token');
    // Credenciais fixas (LocalStack) não têm token de sessão.
    expect(validateEnv(validEnv).AWS_SESSION_TOKEN).toBeUndefined();
  });

  it('AWS_SESSION_TOKEN vazio é rejeitado (evita mandar token em branco ao STS)', () => {
    expect(() => validateEnv({ ...validEnv, AWS_SESSION_TOKEN: '' })).toThrow(
      /Invalid environment variables:[\s\S]*AWS_SESSION_TOKEN/,
    );
  });

  it('variável obrigatória ausente: lança listando o nome da variável (fail-fast do boot)', () => {
    const incomplete: Record<string, unknown> = { ...validEnv };
    delete incomplete.INTERNAL_API_TOKEN;

    expect(() => validateEnv(incomplete)).toThrow(
      /Invalid environment variables:[\s\S]*INTERNAL_API_TOKEN/,
    );
  });

  it('lista TODAS as variáveis com problema, não só a primeira', () => {
    const error = (() => {
      try {
        validateEnv({ ...validEnv, API_URL: 'not-a-url', S3_BUCKET_NAME: '' });
        return null;
      } catch (err) {
        return err as Error;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('API_URL');
    expect(error?.message).toContain('S3_BUCKET_NAME');
  });

  it('config completamente vazio: mensagem cobre todas as obrigatórias', () => {
    const error = (() => {
      try {
        validateEnv({});
        return null;
      } catch (err) {
        return err as Error;
      }
    })();

    for (const key of Object.keys(validEnv)) {
      expect(error?.message).toContain(key);
    }
  });
});
