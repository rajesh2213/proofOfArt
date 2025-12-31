import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import { artworkClaimService } from '../services/artworkClaimService';
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';

export class ArtworkClaimController {
    /**
     * POST /api/art/claim/:artworkId
     * Create a new artwork claim
     */
    createClaim = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'createClaim');
        }

        const artworkId = req.params.artworkId;
        const { reason } = req.body;

        const claim = await artworkClaimService.createClaim(artworkId, userId, reason);

        res.status(201).json({
            success: true,
            message: 'Claim submitted successfully',
            data: {
                claim
            }
        });
    });

    /**
     * GET /api/art/claims/my
     * Get user's claims
     */
    getMyClaims = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getMyClaims');
        }

        const claims = await artworkClaimService.getUserClaims(userId);

        res.status(200).json({
            success: true,
            message: 'Claims retrieved successfully',
            data: {
                claims,
                count: claims.length
            }
        });
    });

    /**
     * POST /api/art/claims/:claimId/approve
     * Approve a claim (requires admin or artwork owner)
     */
    approveClaim = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'approveClaim');
        }

        const claimId = req.params.claimId;

        const claim = await artworkClaimService.getClaimById(claimId);
        if (!claim) {
            res.status(404).json({
                success: false,
                message: 'Claim not found',
                data: null
            });
            return;
        }

        const isAdmin = userRole === 'ADMIN';
        const isOwner = claim.artwork.currentOwnerId === userId;

        if (!isAdmin && !isOwner) {
            res.status(403).json({
                success: false,
                message: 'You do not have permission to approve this claim',
                data: null
            });
            return;
        }

        const updatedClaim = await artworkClaimService.approveClaim(claimId, userId);

        res.status(200).json({
            success: true,
            message: 'Claim approved successfully',
            data: {
                claim: updatedClaim
            }
        });
    });

    /**
     * POST /api/art/claims/:claimId/reject
     * Reject a claim (requires admin or artwork owner)
     */
    rejectClaim = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'rejectClaim');
        }

        const claimId = req.params.claimId;

        const claim = await artworkClaimService.getClaimById(claimId);
        if (!claim) {
            res.status(404).json({
                success: false,
                message: 'Claim not found',
                data: null
            });
            return;
        }

        const isAdmin = userRole === 'ADMIN';
        const isOwner = claim.artwork.currentOwnerId === userId;

        if (!isAdmin && !isOwner) {
            res.status(403).json({
                success: false,
                message: 'You do not have permission to reject this claim',
                data: null
            });
            return;
        }

        const updatedClaim = await artworkClaimService.rejectClaim(claimId, userId);

        res.status(200).json({
            success: true,
            message: 'Claim rejected successfully',
            data: {
                claim: updatedClaim
            }
        });
    });
}

export const artworkClaimController = new ArtworkClaimController();

