import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  const healthService = {
    getHealth: jest.fn(),
  };

  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return ok status with 200 response when health is healthy', async () => {
    healthService.getHealth.mockResolvedValue({ status: 'ok' });

    await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(response.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('should return service unavailable when health is degraded', async () => {
    healthService.getHealth.mockResolvedValue({ status: 'error' });

    await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(response.json).toHaveBeenCalledWith({ status: 'error' });
  });
});
