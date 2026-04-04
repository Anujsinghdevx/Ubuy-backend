import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
};

type ListNotificationsInput = {
  userId: string;
  page?: number;
  limit?: number;
  isRead?: boolean;
  type?: NotificationType;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async createNotification(input: CreateNotificationInput) {
    const basePayload = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? {},
      dedupeKey: input.dedupeKey,
    };

    if (input.dedupeKey) {
      return this.notificationModel.findOneAndUpdate(
        {
          userId: input.userId,
          dedupeKey: input.dedupeKey,
        },
        {
          $setOnInsert: {
            ...basePayload,
            isRead: false,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );
    }

    return this.notificationModel.create({
      ...basePayload,
      isRead: false,
    });
  }

  async listNotifications(input: ListNotificationsInput) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));

    const filter: {
      userId: string;
      isRead?: boolean;
      type?: NotificationType;
    } = {
      userId: input.userId,
    };

    if (typeof input.isRead === 'boolean') {
      filter.isRead = input.isRead;
    }

    if (input.type) {
      filter.type = input.type;
    }

    const [items, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.notificationModel.countDocuments(filter),
    ]);

    return {
      page,
      limit,
      total,
      items,
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationModel.countDocuments({
      userId,
      isRead: false,
    });

    return { unreadCount: count };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: notificationId,
        userId,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true },
    );

    return {
      updated: Boolean(notification),
      notification,
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      {
        userId,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    return {
      updatedCount: result.modifiedCount,
    };
  }

  async deleteAllNotifications(userId: string) {
    const result = await this.notificationModel.deleteMany({ userId });

    return {
      deletedCount: result.deletedCount,
    };
  }

  async deleteReadNotifications(userId: string) {
    const result = await this.notificationModel.deleteMany({
      userId,
      isRead: true,
    });

    return {
      deletedCount: result.deletedCount,
    };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const deleted = await this.notificationModel.findOneAndDelete({
      _id: notificationId,
      userId,
    });

    return {
      deleted: Boolean(deleted),
      notificationId,
    };
  }
}
