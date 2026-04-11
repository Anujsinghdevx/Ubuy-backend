import { AppService } from './app.service';

describe('AppService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should expose admin links in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '6000';

    const service = new AppService();
    const result = service.getRootStatus();

    expect(result.links.docs).toContain('/docs');
    expect(result.links.queueDashboard).toContain('/admin/queues');
  });

  it('should hide admin links in production when disabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '6001';
    delete process.env.ENABLE_ADMIN_TOOLS;

    const service = new AppService();
    const result = service.getRootStatus();

    expect(result.links.docs).toBeUndefined();
    expect(result.links.versionedApiBase).toContain('6001');
  });

  it('should include admin endpoints in api info when enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_ADMIN_TOOLS = 'true';

    const service = new AppService();
    const result = service.getApiInfo();

    expect(result.endpoints.auth).toEqual(expect.any(Array));
    expect(result.endpoints.system).toEqual(expect.any(Array));
  });
});
