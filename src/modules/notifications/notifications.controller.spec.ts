import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notificationsService = {
    listNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    deleteReadNotifications: jest.fn(),
    deleteAllNotifications: jest.fn(),
    deleteNotification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: notificationsService }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should convert filters and pass them to the service', async () => {
    notificationsService.listNotifications.mockResolvedValue({ items: [] });

    const result = await controller.list(
      { userId: 'user-1', email: 'user@ubuy.dev' },
      '2',
      '10',
      'true',
      'SYSTEM',
    );

    expect(result).toEqual({ items: [] });
    expect(notificationsService.listNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      page: 2,
      limit: 10,
      isRead: true,
      type: 'SYSTEM',
    });
  });

  it('should ignore invalid notification type filter', async () => {
    notificationsService.listNotifications.mockResolvedValue({ items: [] });

    await controller.list({ userId: 'user-1', email: 'user@ubuy.dev' }, undefined, undefined, undefined, 'bad-type');

    expect(notificationsService.listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: undefined,
      }),
    );
  });

  it('should reject unread count when user is missing', async () => {
    await expect(controller.unreadCount(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('should proxy delete all notifications for authenticated user', async () => {
    notificationsService.deleteAllNotifications.mockResolvedValue({ deletedCount: 3 });

    await expect(
      controller.deleteAllNotifications({ userId: 'user-1', email: 'user@ubuy.dev' }),
    ).resolves.toEqual({ deletedCount: 3 });
  });
});
