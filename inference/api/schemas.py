from pydantic import BaseModel, HttpUrl, Field

class AnalyzeRequest(BaseModel):
    image_url: HttpUrl

class AIPrediction(BaseModel):
    is_ai_generated: bool
    confidence: float = Field(..., ge=0.0, le=1.0)

class Tampering(BaseModel):
    is_edited: bool
    mask_pixesls: int
    mask_base64: str

class AnalyzeResponse(BaseModel):
    predictions: AIPrediction
    tampering: Tampering

    class Config:
        json_schema_extra = {
            "example": {
                "predictions": {
                    "is_ai_generated": False,
                    "confidence": 0.15
                },
                "tampering": {
                    "is_edited": False,
                    "mask_pixesls": 0,
                    "mask_base64": "data:image/png;base64,iVBORw0KGgoAAAANS..."
                }
            }
        }