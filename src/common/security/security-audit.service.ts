import { Injectable, Logger } from '@nestjs/common';

export type SecurityAuditOutcome =
  | 'success'
  | 'failure'
  | 'attempted'
  | 'blocked';

export type SecurityAuditEvent = {
  domain: 'auth' | 'system';
  action: string;
  outcome: SecurityAuditOutcome;
  actor?: {
    userId?: string;
    email?: string;
  };
  target?: {
    userId?: string;
    email?: string;
  };
  reason?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  logEvent(event: SecurityAuditEvent) {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ...event,
      }),
    );
  }
}
