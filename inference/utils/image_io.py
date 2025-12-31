import requests
from PIL import Image, ImageOps
from io import BytesIO
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def download_image_and_normalize(image_url: str, max_size: int = 1024) -> Image.Image:
    try:
        res = requests.get(image_url, timeout=10)
        res.raise_for_status()

        img = Image.open(BytesIO(res.content)).convert("RGB")
        original_size = img.size

        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_size, max_size))
        
        return img

    except requests.RequestException as e:
        logger.error(f"Error downloading image from {image_url}: {e}")
        raise 
    except Exception as e:
        logger.error(f"Error processing image from {image_url}: {e}")
        raise ValueError(f"Failed to process image: {str(e)}") from e
