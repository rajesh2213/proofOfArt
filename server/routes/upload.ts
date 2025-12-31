import express from 'express';
import uploads from '../config/multer';
import { handleUpload } from '../controllers/uploadController';
import { checkAuthentication } from '../middleware/checkAuthentication';

const uploadRouter = express.Router();

uploadRouter.post('/', checkAuthentication(false), uploads.single('file'), handleUpload);

export default uploadRouter;