# proofOfArt

System for analyzing digital artwork to detect AI generation and localized tampering, with an ownership tracking and cryptographic proof system.

## Overview

This system addresses two problems: verifying whether digital art is AI-generated or human-created, and detecting localized edits like inpainting or object removal. These are independent forensic signals. An AI-generated image may or may not be edited, and an edited image may or may not be AI-generated.

The system also tracks artwork ownership and embeds cryptographic proofs to establish provenance. Users can upload images, and manage ownership claims through a gallery interface.

## Architecture

The system is split into three services:

- **Client** (Next.js): React frontend with GSAP animations, handles image uploads and displays analysis results
- **Server** (Node.js/Express): REST API, job queuing with BullMQ, PostgreSQL database via Prisma, Cloudinary for image storage
- **Inference** (Python/FastAPI): TensorFlow models for classification and localization, runs as a separate service

Data flow: Client uploads image → Server stores in Cloudinary and queues inference job → Worker fetches job from Redis → Worker calls inference service → Results stored in database → Client polls for completion.

## Image Analysis Pipeline

The system answers two independent questions using separate models:

### Classification Model

EfficientNetB0 backbone with a binary classification head. Outputs a probability that the image is AI-generated. Trained on a dataset of real photographs, human-created digital art, and fully AI-generated images.

The classifier does not consider localized edits. A heavily edited photograph can still be classified as human-created if the base image is real.

### Localization Model

EfficientNetB0 encoder with a U-Net decoder for segmentation. Outputs a mask indicating regions of localized tampering (inpainting, object removal, copy-paste edits). The mask is post-processed to compute edited pixel count and area ratio.

The localization model does not distinguish between AI-generated and human-created images. It only identifies where edits occurred.

### Why Separate Models

These tasks have different data requirements and optimization objectives. Classification needs a balanced dataset of AI vs real images. Localization needs paired original/edited samples with ground truth masks. Combining them in a multi-head architecture caused task interference and semantic confusion.

Running them independently allows each model to be optimized for its specific task. Failures in one don't cascade to the other. The results are interpreted jointly in the UI, but the models themselves have no shared weights or dependencies.

## Ownership and Proof System

Each uploaded image can be claimed as an artwork with ownership tracking. The system maintains:

- Original uploader (who first uploaded the image)
- Current owner (who currently owns the artwork)
- Ownership history (transfers between users)
- Artwork claims (disputes over ownership)
- Cryptographic proofs (embedded metadata with signatures)

The proof system uses a key store to manage signing keys. Each artwork can have embedded proof metadata that includes timestamps, ownership information, and optional cryptographic signatures. This provides a basic provenance trail, though the current implementation is more of a framework than a complete verification system.

## Model Training

The models must be trained separately using the standalone scripts:

- `inference/scripts/train_classifier_standalone.py`: Trains the binary classifier
- `inference/scripts/train_localization_standalone.py`: Trains the segmentation model

The system would benefit from:

- Parallel model inference (run classifier and localization simultaneously)
- More sophisticated uncertainty handling in classification
- Automatic claim verification based on upload timestamps and proof metadata
- Batch inference endpoint for processing multiple images
- Webhook notifications instead of client polling
