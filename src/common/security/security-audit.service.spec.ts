import { Logger } from '@nestjs/common';
import { SecurityAuditService } from './security-audit.service';

describe('SecurityAuditService', () => {
  it('should log structured audit events', () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new SecurityAuditService();

    service.logEvent({
      domain: 'auth',
      action: 'login',
      outcome: 'success',
      actor: { email: 'user@ubuy.dev' },
    });

    expect(loggerSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(loggerSpy.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      domain: 'auth',
      action: 'login',
      outcome: 'success',
      actor: { email: 'user@ubuy.dev' },
    });
    expect(payload.timestamp).toEqual(expect.any(String));
  });
});
