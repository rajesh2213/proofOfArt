export type ImageModel = {
  id: string;
  url: string;
  hash: string;
  filename?: string | null;
  status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  metadata: any;
  imageClaims: ImageClaim[];
  detectionReport?: DetectionReport | null;
}

export type ImageMetaData = {
  width: number;
  height: number;
  format: string;
  version: number;
  resource_type: string;
  type: string;
  created_at: string;
  bytes: number;
  tags: string[];
  title?: string;
  art_creation_date?: string;
  allow_ai_training?: boolean;
  art_type?: string;
  is_made_by_user?: boolean;
}

export type ImageClaim = {
  userId: string;
  imageId: string;
  id: string;
  sessionId: string | null;
  isPrimaryOwner: boolean;
  uploadDate: Date;
  claimEvidenceMetadata: any;
}