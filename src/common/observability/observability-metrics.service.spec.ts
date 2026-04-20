import { ObservabilityMetricsService } from './observability-metrics.service';

describe('ObservabilityMetricsService', () => {
  it('should normalize dynamic route segments', () => {
    const service = new ObservabilityMetricsService();

    expect(
      service.normalizeRoute('/v1/auctions/507f1f77bcf86cd799439011'),
    ).toBe('/v1/auctions/:id');
    expect(service.normalizeRoute('/v1/users/123?include=stats')).toBe(
      '/v1/users/:id',
    );
  });

  it('should export request metrics in prometheus format', () => {
    const service = new ObservabilityMetricsService();

    service.recordHttpRequest({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationMs: 12.5,
    });
    service.recordHttpRequest({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationMs: 7.25,
    });
    service.recordHttpRequest({
      method: 'POST',
      route: '/v1/auth/login',
      statusCode: 401,
      durationMs: 4,
    });

    const metrics = service.getPrometheusMetrics();

    expect(metrics).toContain('# HELP ubuy_http_requests_observed_total');
    expect(metrics).toContain('ubuy_http_requests_observed_total 3');
    expect(metrics).toContain(
      'ubuy_http_requests_total{method="GET",route="/health",status="200"} 2',
    );
    expect(metrics).toContain(
      'ubuy_http_request_duration_ms_count{method="GET",route="/health",status="200"} 2',
    );
    expect(metrics).toContain(
      'ubuy_http_request_duration_ms_sum{method="GET",route="/health",status="200"} 19.75',
    );
    expect(metrics).toContain('ubuy_process_uptime_seconds');
    expect(metrics).toContain('ubuy_process_memory_rss_bytes');
    expect(metrics).toContain('ubuy_process_memory_heap_used_bytes');
  });
});
