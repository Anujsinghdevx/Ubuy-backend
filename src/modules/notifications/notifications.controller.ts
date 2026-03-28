import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  NOTIFICATION_TYPES,
  NotificationType,
} from './schemas/notification.schema';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const pageNumber = page ? Number(page) : undefined;
    const limitNumber = limit ? Number(limit) : undefined;
    const isReadFilter =
      isRead === undefined ? undefined : isRead.toLowerCase() === 'true';
    const typeFilter =
      typeof type === 'string' &&
      (NOTIFICATION_TYPES as readonly string[]).includes(type)
        ? (type as NotificationType)
        : undefined;

    return this.notificationsService.listNotifications({
      userId: user.userId,
      page: Number.isFinite(pageNumber) ? pageNumber : undefined,
      limit: Number.isFinite(limitNumber) ? limitNumber : undefined,
      isRead: isReadFilter,
      type: typeFilter,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.getUnreadCount(user.userId);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') notificationId: string,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.markAsRead(user.userId, notificationId);
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.markAllAsRead(user.userId);
  }
}
