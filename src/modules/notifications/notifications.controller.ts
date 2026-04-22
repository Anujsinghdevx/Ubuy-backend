import {
  Controller,
  Delete,
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: 'List notifications for authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Notifications list',
    example: {
      data: [
        {
          id: '507f1f77bcf86cd799439011',
          message: 'Your bid was outbid',
          isRead: false,
          type: 'bid',
          timestamp: '2026-04-04T10:30:00Z',
        },
      ],
      total: 5,
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (1-based)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    description: 'Page size',
  })
  @ApiQuery({
    name: 'isRead',
    required: false,
    type: Boolean,
    example: false,
    description: 'Filter by read/unread notifications',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NOTIFICATION_TYPES,
    example: 'bid',
    description: 'Filter by notification type',
  })
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

  @ApiOperation({ summary: 'Get unread notifications count' })
  @ApiResponse({
    status: 200,
    description: 'Unread count',
    example: { unreadCount: 3 },
  })
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.getUnreadCount(user.userId);
  }

  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
    example: { success: true, id: '507f1f77bcf86cd799439011' },
  })
  @ApiParam({
    name: 'id',
    description: 'Notification identifier',
    example: '507f1f77bcf86cd799439011',
  })
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

  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({
    status: 200,
    description: 'All notifications marked as read',
    example: { success: true, updated: 5 },
  })
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.markAllAsRead(user.userId);
  }

  @ApiOperation({ summary: 'Delete all read notifications' })
  @ApiResponse({
    status: 200,
    description: 'Read notifications deleted',
    example: { deletedCount: 4 },
  })
  @Delete('read')
  async deleteReadNotifications(
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.deleteReadNotifications(user.userId);
  }

  @ApiOperation({ summary: 'Delete all notifications for authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'All notifications deleted',
    example: { deletedCount: 12 },
  })
  @Delete()
  async deleteAllNotifications(
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.deleteAllNotifications(user.userId);
  }

  @ApiOperation({ summary: 'Delete one notification' })
  @ApiResponse({
    status: 200,
    description: 'Notification deleted',
    example: { deleted: true, notificationId: '507f1f77bcf86cd799439011' },
  })
  @ApiParam({
    name: 'id',
    description: 'Notification identifier',
    example: '507f1f77bcf86cd799439011',
  })
  @Delete(':id')
  async deleteNotification(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') notificationId: string,
  ) {
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return this.notificationsService.deleteNotification(
      user.userId,
      notificationId,
    );
  }
}
