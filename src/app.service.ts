import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRootStatus() {
    const port = Number(process.env.PORT ?? 6000);
    const baseUrl = `http://localhost:${port}`;
    const versionPrefix = '/v1';
    const isProduction = process.env.NODE_ENV === 'production';
    const enableAdminTools = process.env.ENABLE_ADMIN_TOOLS === 'true';
    const showAdminLinks = !isProduction || enableAdminTools;

    const links = {
      health: `${baseUrl}/health`,
      versionedApiBase: `${baseUrl}${versionPrefix}`,
      ...(showAdminLinks
        ? {
            docs: `${baseUrl}/docs`,
            docsJson: `${baseUrl}/docs-json`,
            apiInfo: `${baseUrl}/api-info`,
            queueDashboard: `${baseUrl}/admin/queues`,
          }
        : {}),
    };

    return {
      status: 'ok',
      message: 'Ubuy backend is running',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      service: 'Ubuy Backend',
      environment: process.env.NODE_ENV ?? 'development',
      links,
    };
  }

  getApiInfo() {
    const port = Number(process.env.PORT ?? 6000);
    const baseUrl = `http://localhost:${port}`;
    const versionPrefix = '/v1';
    const isProduction = process.env.NODE_ENV === 'production';
    const enableAdminTools = process.env.ENABLE_ADMIN_TOOLS === 'true';
    const showAdminLinks = !isProduction || enableAdminTools;

    const systemEndpoints = [
      { method: 'GET', path: '/', auth: 'public' },
      { method: 'GET', path: '/api-info', auth: 'public' },
    ];

    if (showAdminLinks) {
      systemEndpoints.push(
        { method: 'GET', path: '/docs', auth: 'public' },
        { method: 'GET', path: '/docs-json', auth: 'public' },
        { method: 'GET', path: '/admin/queues', auth: 'public' },
      );
    }

    return {
      status: 'ok',
      message: 'API discovery document',
      timestamp: new Date().toISOString(),
      service: {
        name: 'Ubuy Backend',
        environment: process.env.NODE_ENV ?? 'development',
        port,
        baseUrl,
      },
      endpoints: {
        health: [{ method: 'GET', path: '/health', auth: 'public' }],
        auth: [
          {
            method: 'GET',
            path: `${versionPrefix}/auth/check-username-unique`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/check-username-unique`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/signup`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/login`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/google`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/verify-email`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/forgot-password`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/resend-code`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/reset-code`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/verify-code`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/reset-password`,
            auth: 'public',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/auth/public-profile/:username`,
            auth: 'public',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auth/profile`,
            auth: 'jwt',
          },
          {
            method: 'PATCH',
            path: `${versionPrefix}/auth/update-profile`,
            auth: 'jwt',
          },
          { method: 'GET', path: `${versionPrefix}/auth/me`, auth: 'jwt' },
        ],
        users: [
          {
            method: 'GET',
            path: `${versionPrefix}/users/me/bid-stats`,
            auth: 'jwt',
          },
        ],
        auctions: [
          { method: 'POST', path: `${versionPrefix}/auctions`, auth: 'jwt' },
          { method: 'GET', path: `${versionPrefix}/auctions`, auth: 'public' },
          {
            method: 'GET',
            path: `${versionPrefix}/auctions/active`,
            auth: 'public',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/auctions/me/bidded`,
            auth: 'jwt',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/auctions/queue/status`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auctions/:id/end`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auctions/:id/cancel`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auctions/:id/payment/confirm`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auctions/:id/payment-expiry/decision`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/auctions/:id/bids`,
            auth: 'jwt',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/auctions/:id`,
            auth: 'public',
          },
        ],
        payments: [
          {
            method: 'POST',
            path: `${versionPrefix}/payments/cashfree/link`,
            auth: 'jwt',
          },
          {
            method: 'POST',
            path: `${versionPrefix}/payments/webhook`,
            auth: 'public (x-webhook-secret required)',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/payments/cashfree/verify`,
            auth: 'public',
          },
        ],
        uploads: [
          {
            method: 'POST',
            path: `${versionPrefix}/uploads/images`,
            auth: 'jwt',
            limits: 'max 5 files, 10MB each, 5 requests/minute/IP',
          },
        ],
        notifications: [
          {
            method: 'GET',
            path: `${versionPrefix}/notifications`,
            auth: 'jwt',
          },
          {
            method: 'GET',
            path: `${versionPrefix}/notifications/unread-count`,
            auth: 'jwt',
          },
          {
            method: 'PATCH',
            path: `${versionPrefix}/notifications/:id/read`,
            auth: 'jwt',
          },
          {
            method: 'PATCH',
            path: `${versionPrefix}/notifications/read-all`,
            auth: 'jwt',
          },
        ],
        system: [...systemEndpoints],
      },
      websockets: {
        transport: 'socket.io',
        guard: 'jwt',
        events: ['joinAuction', 'leaveAuction', 'placeBid'],
      },
      notes: {
        success:
          'Use /docs as the canonical API contract and /api-info as an integration index.',
        healthCheck: `${baseUrl}/health`,
        ...(showAdminLinks
          ? {
              docs: `${baseUrl}/docs`,
              docsJson: `${baseUrl}/docs-json`,
              queueDashboard: `${baseUrl}/admin/queues`,
            }
          : {}),
        versionedApiBase: `${baseUrl}${versionPrefix}`,
      },
    };
  }
}
