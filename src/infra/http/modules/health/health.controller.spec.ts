import { HealthController } from './health.controller';

describe('HealthController (unit)', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  describe('healthCheck', () => {
    it('should return status ok with timestamp', () => {
      const result = controller.healthCheck();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('readinessCheck', () => {
    it('should return status ready with timestamp', () => {
      const result = controller.readinessCheck();

      expect(result.status).toBe('ready');
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });
  });
});
