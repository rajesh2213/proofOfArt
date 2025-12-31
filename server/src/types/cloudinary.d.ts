export type CloudinaryResource = {
    asset_id: string;
    public_id: string;
    folder: string;
    filename: string;
    resource_type: 'image' | 'video' | 'raw';
    type: string;
    format: string;
    version: number;
    created_at: string;
    bytes: number;
    width: number;
    height: number;
    url: string;
    secure_url: string;
    display_name: string;
    etag: string;
    placeholder: boolean;
    access_mode: 'public' | 'authenticated' | 'private';
    created_by?: {
      access_key: string | null;
      external_id: string | null;
    };
    uploaded_by?: {
      access_key: string | null;
      external_id: string | null;
    };
    tags?: string[];
    metadata?: Record<string, string>;
    url_backup?: string | null;
  }
  