import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;

  const appService = {
    getRootStatus: jest.fn(),
    getApiInfo: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('should proxy root status to app service', () => {
    appService.getRootStatus.mockReturnValue({ status: 'ok' });

    expect(controller.getRootStatus()).toEqual({ status: 'ok' });
    expect(appService.getRootStatus).toHaveBeenCalledTimes(1);
  });

  it('should proxy api info to app service', () => {
    appService.getApiInfo.mockReturnValue({ status: 'ok' });

    expect(controller.getApiInfo()).toEqual({ status: 'ok' });
    expect(appService.getApiInfo).toHaveBeenCalledTimes(1);
  });
});
