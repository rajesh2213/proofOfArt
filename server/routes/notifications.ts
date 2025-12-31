import express from 'express';
import { checkAuthentication } from '../middleware/checkAuthentication';
import { notificationController } from '../controllers/notificationController';

const notificationRouter = express.Router();

notificationRouter.use(checkAuthentication(true));

notificationRouter.get('/', notificationController.getNotifications);
notificationRouter.get('/unread-count', notificationController.getUnreadCount);
notificationRouter.post('/:id/read', notificationController.markAsRead);
notificationRouter.post('/mark-all-read', notificationController.markAllAsRead);
notificationRouter.delete('/:id', notificationController.deleteNotification);

export default notificationRouter;

