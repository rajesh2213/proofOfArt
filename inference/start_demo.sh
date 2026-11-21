#!/bin/bash
# Start inference service with synthetic demo mode enabled
export USE_SYNTHETIC_DEMO=true
uvicorn main:app --reload --host 0.0.0.0 --port 8000

