import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ObservabilityMetricsService } from '@/common/observability/observability-metrics.service';

type ObservabilityRequest = Request & {
  requestId?: string;
};

@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpObservabilityMiddleware.name);
  private readonly slowRequestThresholdMs = Number(
    process.env.SLOW_HTTP_REQUEST_TRACE_MS ?? 250,
  );

  constructor(
    private readonly observabilityMetricsService: ObservabilityMetricsService,
  ) {}

  use(req: ObservabilityRequest, res: Response, next: NextFunction) {
    const requestIdHeader = req.header('x-request-id');
    const requestId = requestIdHeader || randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();
    const method = req.method;
    const path = req.originalUrl ?? req.url;
    const normalizedRoute =
      this.observabilityMetricsService.normalizeRoute(path);
    const ip = req.ip;
    const userAgent = req.get('user-agent');
    let logged = false;

    const logRequest = (event: 'http_request' | 'http_request_aborted') => {
      if (logged) {
        return;
      }

      logged = true;

      const durationMs = Number(
        (process.hrtime.bigint() - startedAt) / BigInt(1_000_000),
      );
      const statusCode =
        event === 'http_request_aborted'
          ? res.statusCode || 499
          : res.statusCode || 200;
      const message = JSON.stringify({
        event,
        requestId,
        method,
        path,
        statusCode,
        durationMs,
        ip,
        userAgent,
      });

      if (event === 'http_request_aborted') {
        this.observabilityMetricsService.recordHttpRequest({
          method,
          route: normalizedRoute,
          statusCode,
          durationMs,
        });
        this.logger.warn(message);
        return;
      }

      this.observabilityMetricsService.recordHttpRequest({
        method,
        route: normalizedRoute,
        statusCode,
        durationMs,
      });

      if (
        event === 'http_request' &&
        durationMs >= this.slowRequestThresholdMs
      ) {
        this.logger.warn(
          JSON.stringify({
            event: 'slow_http_request',
            requestId,
            method,
            path,
            route: normalizedRoute,
            statusCode,
            durationMs,
            thresholdMs: this.slowRequestThresholdMs,
            ip,
            userAgent,
          }),
        );
      }

      if (statusCode >= 500) {
        this.logger.error(message);
        return;
      }

      if (statusCode >= 400) {
        this.logger.warn(message);
        return;
      }

      this.logger.log(message);
    };

    res.once('finish', () => {
      logRequest('http_request');
    });

    res.once('close', () => {
      if (!res.writableEnded) {
        logRequest('http_request_aborted');
      }
    });

    next();
  }
}
