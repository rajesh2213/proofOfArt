from typing import Optional
from pydantic import BaseModel, HttpUrl, Field


class AnalyzeRequest(BaseModel):
    image_url: HttpUrl


class AIPrediction(BaseModel):
    is_ai_generated: bool
    is_uncertain: bool = False
    confidence: float = Field(..., ge=0.0, le=1.0)


class Tampering(BaseModel):
    detected: bool = Field(..., description="True if tampering is detected")
    mask_base64: Optional[str] = Field(
        None, 
        description="Base64 PNG mask (null if no tampering detected)"
    )
    edited_area_ratio: float = Field(
        ..., 
        ge=0.0, 
        le=1.0,
        description="Ratio of edited pixels to total image pixels"
    )
    edited_pixels: int = Field(
        ..., 
        ge=0,
        description="Absolute count of edited pixels"
    )


class AnalyzeResponse(BaseModel):
    predictions: AIPrediction
    tampering: Tampering

    class Config:
        json_schema_extra = {
            "example": {
                "predictions": {
                    "is_ai_generated": False,
                    "is_uncertain": False,
                    "confidence": 0.15
                },
                "tampering": {
                    "detected": False,
                    "mask_base64": None,
                    "edited_area_ratio": 0.0,
                    "edited_pixels": 0
                }
            }
        }
