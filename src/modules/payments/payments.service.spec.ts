import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { AuctionsService } from '@/modules/auctions/auctions.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { BidsGateway } from '@/modules/bids/bids.gateway';
import { UsersService } from '@/modules/users/users.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const configService = {
    get: jest.fn(),
  };

  const auctionsService = {
    findById: jest.fn(),
    confirmWinnerPaymentByProvider: jest.fn(),
  };

  const notificationsService = {
    createNotification: jest.fn(),
  };

  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const bidsGateway = {
    server: {
      to,
    },
  };

  const usersService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: ConfigService, useValue: configService },
        { provide: AuctionsService, useValue: auctionsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: BidsGateway, useValue: bidsGateway },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should throw unauthorized exception for invalid webhook secret', () => {
    configService.get.mockReturnValue('expected-secret');

    expect(() => service.validateWebhookSecret('wrong-secret')).toThrow(
      UnauthorizedException,
    );
  });

  it('should return accepted response for failed webhook status', async () => {
    const result = await service.handleWebhook({
      auctionId: '507f1f77bcf86cd799439011',
      status: 'FAILED',
    });

    expect(result).toEqual({
      message: 'Payment failure received. Auction remains unpaid.',
      accepted: true,
    });
    expect(
      auctionsService.confirmWinnerPaymentByProvider,
    ).not.toHaveBeenCalled();
  });

  it('should throw when cashfree credentials are missing while creating payment link', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CASHFREE_CLIENT_ID') {
        return undefined;
      }
      if (key === 'CASHFREE_CLIENT_SECRET') {
        return undefined;
      }
      return undefined;
    });

    await expect(
      service.createCashfreePaymentLink('user-1', {
        auctionId: '507f1f77bcf86cd799439011',
        customerPhone: '9876543210',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('should create payment link successfully and map response fields', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CASHFREE_CLIENT_ID') {
        return 'client-id';
      }
      if (key === 'CASHFREE_CLIENT_SECRET') {
        return 'client-secret';
      }
      if (key === 'CASHFREE_BASE_URL') {
        return 'https://sandbox.cashfree.com';
      }
      if (key === 'CASHFREE_API_VERSION') {
        return '2025-01-01';
      }
      if (key === 'FRONTEND_BASE_URL') {
        return 'https://ubuy.app';
      }
      return undefined;
    });

    auctionsService.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      title: 'Vintage Jacket',
      status: 'ENDED',
      winner: 'winner-1',
      createdBy: 'creator-1',
      paymentStatus: 'ACTIVE',
      currentPrice: 1500,
    } as never);

    usersService.findById.mockResolvedValue({
      _id: 'winner-1',
      email: 'winner@ubuy.dev',
      name: 'Winner User',
      username: 'winner',
    } as never);

    const fetchMock = jest
      .spyOn(globalThis, 'fetch' as never)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          link_id: 'auction_507f1f77bcf86cd799439011_123',
          link_url: 'https://cashfree.test/link',
          link_status: 'ACTIVE',
        }),
      } as never);

    const result = await service.createCashfreePaymentLink('winner-1', {
      auctionId: '507f1f77bcf86cd799439011',
      customerPhone: '9876543210',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        message: 'Payment link created successfully',
        auctionId: '507f1f77bcf86cd799439011',
        winner: 'winner-1',
        linkId: 'auction_507f1f77bcf86cd799439011_123',
        linkUrl: 'https://cashfree.test/link',
        status: 'ACTIVE',
      }),
    );
  });

  it('should map provider error when cashfree returns non-ok response', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CASHFREE_CLIENT_ID') {
        return 'client-id';
      }
      if (key === 'CASHFREE_CLIENT_SECRET') {
        return 'client-secret';
      }
      if (key === 'CASHFREE_BASE_URL') {
        return 'https://sandbox.cashfree.com';
      }
      if (key === 'CASHFREE_API_VERSION') {
        return '2025-01-01';
      }
      return undefined;
    });

    auctionsService.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      title: 'Vintage Jacket',
      status: 'ENDED',
      winner: 'winner-1',
      createdBy: 'creator-1',
      paymentStatus: 'ACTIVE',
      currentPrice: 1500,
    } as never);

    usersService.findById.mockResolvedValue({
      _id: 'winner-1',
      email: 'winner@ubuy.dev',
      username: 'winner',
    } as never);

    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as never);

    await expect(
      service.createCashfreePaymentLink('winner-1', {
        auctionId: '507f1f77bcf86cd799439011',
        customerPhone: '9876543210',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
