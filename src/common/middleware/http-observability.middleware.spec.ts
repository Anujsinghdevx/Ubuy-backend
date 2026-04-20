import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import { ObservabilityMetricsService } from '@/common/observability/observability-metrics.service';

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('HttpObservabilityMiddleware', () => {
  const randomUUIDMock = randomUUID as jest.Mock;

  const buildMetricsService = () =>
    ({
      normalizeRoute: jest.fn((path: string) => path),
      recordHttpRequest: jest.fn(),
    }) as unknown as ObservabilityMetricsService & {
      normalizeRoute: jest.Mock;
      recordHttpRequest: jest.Mock;
    };

  const buildResponse = () => {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      statusCode: 200,
      writableEnded: true,
      setHeader: jest.fn(),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    randomUUIDMock.mockReturnValue('generated-request-id');
    delete process.env.SLOW_HTTP_REQUEST_TRACE_MS;
  });

  it('should attach the incoming request id and log structured finish data', () => {
    const loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation();
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const metricsService = buildMetricsService();

    const middleware = new HttpObservabilityMiddleware(metricsService);
    const next = jest.fn();
    const response = buildResponse();
    const request = {
      header: jest.fn().mockReturnValue('request-123'),
      get: jest.fn().mockReturnValue('jest-agent'),
      method: 'POST',
      originalUrl: '/v1/auth/login',
      url: '/v1/auth/login',
      ip: '127.0.0.1',
      requestId: undefined,
    } as any;

    middleware.use(request, response as any, next);
    response.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'request-123',
    );
    expect(request.requestId).toBe('request-123');
    expect(randomUUIDMock).not.toHaveBeenCalled();
    expect(metricsService.normalizeRoute).toHaveBeenCalledWith(
      '/v1/auth/login',
    );
    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith({
      method: 'POST',
      route: '/v1/auth/login',
      statusCode: 200,
      durationMs: expect.any(Number),
    });
    expect(loggerLogSpy).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();

    const payload = JSON.parse(loggerLogSpy.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      event: 'http_request',
      requestId: 'request-123',
      method: 'POST',
      path: '/v1/auth/login',
      statusCode: 200,
      ip: '127.0.0.1',
      userAgent: 'jest-agent',
    });
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should generate a request id and warn on aborted requests', () => {
    const loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation();
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const metricsService = buildMetricsService();

    const middleware = new HttpObservabilityMiddleware(metricsService);
    const next = jest.fn();
    const response = buildResponse();
    response.writableEnded = false;
    response.statusCode = 499;

    const request = {
      header: jest.fn().mockReturnValue(undefined),
      get: jest.fn().mockReturnValue(undefined),
      method: 'GET',
      originalUrl: '/health',
      url: '/health',
      ip: '127.0.0.1',
      requestId: undefined,
    } as any;

    middleware.use(request, response as any, next);
    response.emit('close');

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'generated-request-id',
    );
    expect(request.requestId).toBe('generated-request-id');
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(metricsService.normalizeRoute).toHaveBeenCalledWith('/health');
    expect(metricsService.recordHttpRequest).toHaveBeenCalledWith({
      method: 'GET',
      route: '/health',
      statusCode: 499,
      durationMs: expect.any(Number),
    });
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();

    const payload = JSON.parse(loggerWarnSpy.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      event: 'http_request_aborted',
      requestId: 'generated-request-id',
      method: 'GET',
      path: '/health',
      statusCode: 499,
      ip: '127.0.0.1',
    });
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit a slow request trace when the threshold is exceeded', () => {
    process.env.SLOW_HTTP_REQUEST_TRACE_MS = '0';

    const loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation();
    const loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const metricsService = buildMetricsService();

    const middleware = new HttpObservabilityMiddleware(metricsService);
    const next = jest.fn();
    const response = buildResponse();

    const request = {
      header: jest.fn().mockReturnValue('request-456'),
      get: jest.fn().mockReturnValue('jest-agent'),
      method: 'GET',
      originalUrl: '/v1/health',
      url: '/v1/health',
      ip: '127.0.0.1',
      requestId: undefined,
    } as any;

    middleware.use(request, response as any, next);
    response.emit('finish');

    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(loggerWarnSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('slow_http_request');
    expect(payload.requestId).toBe('request-456');
    expect(payload.route).toBe('/v1/health');
    expect(loggerLogSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});
