import { prisma } from '../config/prismaClient';
import { DatabaseError } from '../utils/errors';
import logger from '../utils/logger';

export interface NotificationWithRelations {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    artworkId: string | null;
    claimId: string | null;
    read: boolean;
    createdAt: Date;
}

export class NotificationService {
    async createNotification(
        userId: string,
        type: string,
        title: string,
        message: string,
        artworkId?: string,
        claimId?: string
    ): Promise<NotificationWithRelations> {
        try {
            const notification = await prisma.notification.create({
                data: {
                    userId,
                    type,
                    title,
                    message,
                    artworkId: artworkId || null,
                    claimId: claimId || null,
                    read: false
                }
            });

            logger.info('Notification created', {
                notificationId: notification.id,
                userId,
                type
            });

            return notification as unknown as NotificationWithRelations;
        } catch (error: any) {
            logger.error('Error creating notification', {
                error: error.message,
                userId,
                type
            });
            throw new DatabaseError('Error creating notification', 'createNotification');
        }
    }

    /**
     * Get user's notifications
     */
    async getUserNotifications(
        userId: string,
        limit: number = 50,
        offset: number = 0,
        unreadOnly: boolean = false
    ): Promise<NotificationWithRelations[]> {
        try {
            const where: any = { userId };
            if (unreadOnly) {
                where.read = false;
            }

            const notifications = await prisma.notification.findMany({
                where,
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit,
                skip: offset
            });

            return notifications as unknown as NotificationWithRelations[];
        } catch (error: any) {
            logger.error('Error fetching notifications', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching notifications', 'getUserNotifications');
        }
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId: string, userId: string): Promise<boolean> {
        try {
            await prisma.notification.updateMany({
                where: {
                    id: notificationId,
                    userId 
                },
                data: {
                    read: true
                }
            });

            return true;
        } catch (error: any) {
            logger.error('Error marking notification as read', {
                error: error.message,
                notificationId,
                userId
            });
            throw new DatabaseError('Error marking notification as read', 'markAsRead');
        }
    }

    /**
     * Mark all notifications as read for a user
     */
    async markAllAsRead(userId: string): Promise<number> {
        try {
            const result = await prisma.notification.updateMany({
                where: {
                    userId,
                    read: false
                },
                data: {
                    read: true
                }
            });

            return result.count;
        } catch (error: any) {
            logger.error('Error marking all notifications as read', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error marking all notifications as read', 'markAllAsRead');
        }
    }

    /**
     * Get unread count for user
     */
    async getUnreadCount(userId: string): Promise<number> {
        try {
            const count = await prisma.notification.count({
                where: {
                    userId,
                    read: false
                }
            });

            return count;
        } catch (error: any) {
            logger.error('Error getting unread count', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error getting unread count', 'getUnreadCount');
        }
    }

    /**
     * Delete notification
     */
    async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
        try {
            await prisma.notification.deleteMany({
                where: {
                    id: notificationId,
                    userId 
                }
            });

            return true;
        } catch (error: any) {
            logger.error('Error deleting notification', {
                error: error.message,
                notificationId,
                userId
            });
            throw new DatabaseError('Error deleting notification', 'deleteNotification');
        }
    }
}

export const notificationService = new NotificationService();

