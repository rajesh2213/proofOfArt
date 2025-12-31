import express from 'express';
import { getImageStatus, streamImageStatus } from '../controllers/progressController';

const progressRouter = express.Router();

progressRouter.get('/image/:imageId', getImageStatus);

progressRouter.get('/image/:imageId/stream', streamImageStatus);

export default progressRouter;