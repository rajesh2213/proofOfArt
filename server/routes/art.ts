import express from 'express';
import { checkAuthentication } from '../middleware/checkAuthentication';
import { artController } from '../controllers/artController';
import { artworkClaimController } from '../controllers/artworkClaimController';
import uploads from '../config/multer';

const artRouter = express.Router();

artRouter.use(checkAuthentication(true));

artRouter.get('/', artController.getArtworks);
artRouter.get('/my-gallery', artController.getMyGallery);
artRouter.get('/uploaded', artController.getMyUploadedArtworks);
artRouter.get('/claimed', artController.getMyClaimedArtworks);
artRouter.get('/image/:imageId', artController.getArtworkByImageId);
artRouter.get('/image/:imageId/download', artController.downloadArtwork);
artRouter.get('/:id/verify-proof', artController.verifyProof);
artRouter.get('/:id', artController.getArtworkById);

artRouter.post('/claim/:artworkId', artworkClaimController.createClaim);
artRouter.get('/claims/my', artworkClaimController.getMyClaims);
artRouter.post('/claims/:claimId/approve', artworkClaimController.approveClaim);
artRouter.post('/claims/:claimId/reject', artworkClaimController.rejectClaim);

artRouter.post('/artist/public-key', artController.uploadArtistPublicKey);

artRouter.post('/verify-embedded', uploads.single('file'), artController.verifyEmbeddedMetadata);

export default artRouter;

