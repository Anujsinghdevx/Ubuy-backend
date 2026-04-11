import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  const paymentsService = {
    createCashfreePaymentLink: jest.fn(),
    validateWebhookSecret: jest.fn(),
    handleWebhook: jest.fn(),
    verifyCashfreePaymentLink: jest.fn(),
    notifyPaymentForAuction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: paymentsService }],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('should reject createCashfreeLink without authenticated user', async () => {
    await expect(
      controller.createCashfreeLink(
        {
          auctionId: '507f1f77bcf86cd799439011',
          customerPhone: '9876543210',
        } as never,
        undefined,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should validate webhook secret and pass webhook body to service', async () => {
    paymentsService.handleWebhook.mockResolvedValue({ accepted: true });

    await expect(
      controller.paymentWebhook(
        { auctionId: '507f1f77bcf86cd799439011', status: 'SUCCESS' } as never,
        'secret',
      ),
    ).resolves.toEqual({ accepted: true });

    expect(paymentsService.validateWebhookSecret).toHaveBeenCalledWith('secret');
    expect(paymentsService.handleWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ auctionId: '507f1f77bcf86cd799439011' }),
    );
  });

  it('should proxy payment verification lookup', async () => {
    paymentsService.verifyCashfreePaymentLink.mockResolvedValue({ status: 'PAID' });

    await expect(
      controller.verifyCashfreePayment({ linkId: 'auction_123' } as never),
    ).resolves.toEqual({ status: 'PAID' });
  });

  it('should proxy notify payment for authenticated user', async () => {
    paymentsService.notifyPaymentForAuction.mockResolvedValue({
      message: 'Payment link created successfully',
    });

    await expect(
      controller.notifyPayment(
        {
          auctionId: '507f1f77bcf86cd799439011',
          customerPhone: '9876543210',
        } as never,
        { userId: 'user-1', email: 'user@ubuy.dev' },
      ),
    ).resolves.toEqual({ message: 'Payment link created successfully' });
  });
});
