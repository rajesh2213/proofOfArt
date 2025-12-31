const API_BASE_URL = process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:4000';

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    
    if (!token) {
        throw new Error('No authentication token found. Please log in.');
    }
    
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        if (response.status === 401) {
            // Token might be expired, try to refresh
            try {
                const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh-token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                });
                
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    if (refreshData.accessToken) {
                        localStorage.setItem('accessToken', refreshData.accessToken);
                        // Retry the original request with new token
                        const retryHeaders: Record<string, string> = {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${refreshData.accessToken}`,
                            ...(options.headers as Record<string, string> || {}),
                        };
                        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
                            ...options,
                            headers: retryHeaders,
                            credentials: 'include',
                        });
                        if (retryResponse.ok) {
                            return retryResponse.json();
                        }
                    }
                }
                } catch (refreshError) {
                    localStorage.removeItem('accessToken');
                throw new Error('Session expired. Please log in again.');
            }
        }
        
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}

export interface Artwork {
    id: string;
    imageId: string;
    originalUploaderId: string;
    currentOwnerId: string;
    embeddedProof: any;
    proofMetadata?: any;
    createdAt: string;
    updatedAt: string;
    image: {
        id: string;
        hash: string;
        url: string;
        filename: string | null;
        status: string;
        detectionReport: {
            aiProbability: number;
            detectedLabel: string;
        } | null;
        editDetections: Array<{
            editType: string;
            maskUrl: string;
            confidence: number;
        }>;
    };
    originalUploader: {
        id: string;
        username: string;
        email: string;
    };
    currentOwner: {
        id: string;
        username: string;
        email: string;
    };
    claims: Array<{
        id: string;
        requesterId: string;
        reason: string | null;
        status: string;
        createdAt: string;
    }>;
}

export interface ArtworkClaim {
    id: string;
    artworkId: string;
    requesterId: string;
    reason: string | null;
    status: string;
    reviewedById: string | null;
    reviewedAt: string | null;
    createdAt: string;
    updatedAt: string;
    artwork: {
        id: string;
        imageId: string;
        currentOwnerId: string;
        originalUploaderId: string;
    };
    requester: {
        id: string;
        username: string;
        email: string;
    };
}

export interface ProofVerification {
    isValid: boolean;
    wasEdited: boolean;
    originalMetadata: any | null;
    currentHash: string;
    error?: string;
}

export const getArtworks = async (filter: 'all' | 'uploaded' | 'claimed' = 'all', limit = 50, offset = 0) => {
    return apiRequest<{ success: boolean; data: { artworks: Artwork[]; count: number; limit: number; offset: number; filter: string } }>(
        `/api/art?filter=${filter}&limit=${limit}&offset=${offset}`
    );
};

export const getMyGallery = async (limit = 50, offset = 0) => {
    return apiRequest<{ success: boolean; data: { artworks: Artwork[] } }>(
        `/api/art/my-gallery?limit=${limit}&offset=${offset}`
    );
};

export const getMyUploadedArtworks = async (limit = 50, offset = 0) => {
    return apiRequest<{ success: boolean; data: { artworks: Artwork[] } }>(
        `/api/art/uploaded?limit=${limit}&offset=${offset}`
    );
};

export const getMyClaimedArtworks = async (limit = 50, offset = 0) => {
    return apiRequest<{ success: boolean; data: { artworks: Artwork[] } }>(
        `/api/art/claimed?limit=${limit}&offset=${offset}`
    );
};

export const getArtworkById = async (artworkId: string) => {
    return apiRequest<{ success: boolean; data: { artwork: Artwork } }>(
        `/api/art/${artworkId}`
    );
};

export const getArtworkByImageId = async (imageId: string) => {
    return apiRequest<{ success: boolean; data: { artwork: Artwork } }>(
        `/api/art/image/${imageId}`
    );
};

export const verifyArtworkProof = async (artworkId: string, hash?: string) => {
    const hashParam = hash ? `&hash=${hash}` : '';
    return apiRequest<{ success: boolean; data: { verification: ProofVerification } }>(
        `/api/art/${artworkId}/verify-proof${hashParam}`
    );
};

export const createClaim = async (artworkId: string, reason?: string) => {
    return apiRequest<{ success: boolean; data: { claim: ArtworkClaim } }>(
        `/api/art/claim/${artworkId}`,
        {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }
    );
};

export const getMyClaims = async () => {
    return apiRequest<{ success: boolean; data: { claims: ArtworkClaim[] } }>(
        `/api/art/claims/my`
    );
};

export const approveClaim = async (claimId: string) => {
    return apiRequest<{ success: boolean; data: { claim: ArtworkClaim } }>(
        `/api/art/claims/${claimId}/approve`,
        {
            method: 'POST',
        }
    );
};

export const rejectClaim = async (claimId: string) => {
    return apiRequest<{ success: boolean; data: { claim: ArtworkClaim } }>(
        `/api/art/claims/${claimId}/reject`,
        {
            method: 'POST',
        }
    );
};

export const downloadArtwork = async (imageId: string, signer: 'system' | 'artist' = 'system'): Promise<void> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    
    if (!token) {
        throw new Error('No authentication token found. Please log in.');
    }

    const response = await fetch(`${API_BASE_URL}/api/art/image/${imageId}/download?signer=${signer}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'artwork-proof.png';
    if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        if (filenameMatch) {
            filename = filenameMatch[1];
        }
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
};

export const verifyEmbeddedMetadata = async (file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    
    if (!token) {
        throw new Error('No authentication token found. Please log in.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/api/art/verify-embedded`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Verification failed' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
};

export const uploadArtistPublicKey = async (publicKeyPem: string, keyId: string) => {
    return apiRequest<{ success: boolean; data: { keyId: string; ownerType: string; createdAt: string } }>(
        `/api/art/artist/public-key`,
        {
            method: 'POST',
            body: JSON.stringify({ publicKeyPem, keyId }),
        }
    );
};

