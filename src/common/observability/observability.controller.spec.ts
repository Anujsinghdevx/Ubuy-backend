import { ObservabilityController } from './observability.controller';
import { ObservabilityMetricsService } from './observability-metrics.service';

describe('ObservabilityController', () => {
  it('should return prometheus metrics text', () => {
    const observabilityMetricsService = {
      getPrometheusMetrics: jest.fn().mockReturnValue('metrics-body'),
    } as unknown as ObservabilityMetricsService;

    const controller = new ObservabilityController(observabilityMetricsService);

    expect(controller.getMetrics()).toBe('metrics-body');
    expect(
      observabilityMetricsService.getPrometheusMetrics,
    ).toHaveBeenCalledTimes(1);
  });
});
