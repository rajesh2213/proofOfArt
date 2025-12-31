
export type AIPrediction = {
    is_ai_generated: boolean;
    confidence: number;
}

export type Tampering = {
    is_edited: boolean;
    mask_pixesls: number;
    mask_base64: string;
}

export type InferenceResponse = {
    predictions: AIPrediction;
    tampering: Tampering;
}

export type InferenceJobData = {
    imageId: string;
    imageUrl: string;
}