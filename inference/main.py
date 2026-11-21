from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import analyze
from api.routes import feedback as feedback_routes

app = FastAPI(title="ProofOfArt Inference Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router, prefix="/api/v1")
app.include_router(feedback_routes.router, prefix="/api/v1")

@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "inference",
        "endpoints": ["/api/v1/analyze", "/api/v1/predict", "/api/v1/feedback", "/api/v1/feedback/stats"],
    }


@app.get("/health")
def health():
    return health_check()