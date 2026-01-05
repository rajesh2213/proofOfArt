
export type AIPrediction = {
    is_ai_generated: boolean;
    is_uncertain: boolean; 
    confidence: number;
}

export type Tampering = {
    detected: boolean;  
    mask_base64: string | null; 
    edited_area_ratio: number;  
    edited_pixels: number;  
}

export type InferenceResponse = {
    predictions: AIPrediction;
    tampering: Tampering;
}

export type InferenceJobData = {
    imageId: string;
    imageUrl: string;
}