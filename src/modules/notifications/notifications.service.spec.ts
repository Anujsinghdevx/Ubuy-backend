import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const findChain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn(),
  };

  const notificationModel = {
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findOneAndDelete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    findChain.sort.mockReturnThis();
    findChain.skip.mockReturnThis();
    findChain.limit.mockResolvedValue([] as never);

    notificationModel.find.mockReturnValue(findChain as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(Notification.name),
          useValue: notificationModel,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should upsert by dedupeKey when createNotification receives dedupeKey', async () => {
    notificationModel.findOneAndUpdate.mockResolvedValue({
      _id: 'n1',
    } as never);

    const result = await service.createNotification({
      userId: 'u1',
      type: 'SYSTEM',
      title: 'Title',
      message: 'Message',
      dedupeKey: 'dedupe-1',
    });

    expect(notificationModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        userId: 'u1',
        dedupeKey: 'dedupe-1',
      },
      {
        $setOnInsert: expect.objectContaining({
          userId: 'u1',
          type: 'SYSTEM',
          isRead: false,
        }),
      },
      {
        upsert: true,
        returnDocument: 'after',
      },
    );
    expect(notificationModel.create).not.toHaveBeenCalled();
    expect(result).toEqual({ _id: 'n1' });
  });

  it('should normalize pagination and return listNotifications payload', async () => {
    const items = [{ _id: 'a' }, { _id: 'b' }];
    findChain.limit.mockResolvedValue(items as never);
    notificationModel.countDocuments.mockResolvedValue(2 as never);

    const result = await service.listNotifications({
      userId: 'u1',
      page: 0,
      limit: 999,
      isRead: false,
      type: 'SYSTEM',
    });

    expect(notificationModel.find).toHaveBeenCalledWith({
      userId: 'u1',
      isRead: false,
      type: 'SYSTEM',
    });
    expect(findChain.skip).toHaveBeenCalledWith(0);
    expect(findChain.limit).toHaveBeenCalledWith(100);
    expect(result).toEqual({
      page: 1,
      limit: 100,
      total: 2,
      items,
    });
  });

  it('should return unread count', async () => {
    notificationModel.countDocuments.mockResolvedValue(7 as never);

    await expect(service.getUnreadCount('u1')).resolves.toEqual({
      unreadCount: 7,
    });
    expect(notificationModel.countDocuments).toHaveBeenCalledWith({
      userId: 'u1',
      isRead: false,
    });
  });

  it('should mark all unread notifications as read', async () => {
    notificationModel.updateMany.mockResolvedValue({
      modifiedCount: 3,
    } as never);

    await expect(service.markAllAsRead('u2')).resolves.toEqual({
      updatedCount: 3,
    });
    expect(notificationModel.updateMany).toHaveBeenCalledWith(
      {
        userId: 'u2',
        isRead: false,
      },
      {
        $set: expect.objectContaining({
          isRead: true,
        }),
      },
    );
  });
});
