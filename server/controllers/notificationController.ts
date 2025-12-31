import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import { notificationService } from '../services/notificationService';
import { ValidationError } from '../utils/errors';

export class NotificationController {
    /**
     * GET /api/notifications
     * Get user's notifications
     */
    getNotifications = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getNotifications');
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const unreadOnly = req.query.unreadOnly === 'true';

        const notifications = await notificationService.getUserNotifications(
            userId,
            limit,
            offset,
            unreadOnly
        );

        res.status(200).json({
            success: true,
            message: 'Notifications retrieved successfully',
            data: {
                notifications,
                count: notifications.length,
                limit,
                offset
            }
        });
    });

    /**
     * GET /api/notifications/unread-count
     * Get unread notification count
     */
    getUnreadCount = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getUnreadCount');
        }

        const count = await notificationService.getUnreadCount(userId);

        res.status(200).json({
            success: true,
            message: 'Unread count retrieved successfully',
            data: {
                unreadCount: count
            }
        });
    });

    /**
     * POST /api/notifications/:id/read
     * Mark notification as read
     */
    markAsRead = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'markAsRead');
        }

        const notificationId = req.params.id;

        await notificationService.markAsRead(notificationId, userId);

        res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            data: null
        });
    });

    /**
     * POST /api/notifications/mark-all-read
     * Mark all notifications as read
     */
    markAllAsRead = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'markAllAsRead');
        }

        const count = await notificationService.markAllAsRead(userId);

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read',
            data: {
                markedCount: count
            }
        });
    });

    /**
     * DELETE /api/notifications/:id
     * Delete notification
     */
    deleteNotification = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'deleteNotification');
        }

        const notificationId = req.params.id;

        await notificationService.deleteNotification(notificationId, userId);

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully',
            data: null
        });
    });
}

export const notificationController = new NotificationController();

