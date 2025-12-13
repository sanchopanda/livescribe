"""
Vosk STT Service - Python microservice for speech recognition
Communicates with Node.js backend via HTTP API
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import vosk
import json
import os
import base64

app = FastAPI(title="LiveScribe STT Service")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global recognizer instances (one per language)
recognizers: dict[str, vosk.Model] = {}
models: dict[str, vosk.Recognizer] = {}


class InitializeRequest(BaseModel):
    language: str  # e.g., "ru-RU", "en-US"


class AudioChunkRequest(BaseModel):
    language: str
    chunk: str  # base64 encoded PCM Int16
    sample_rate: int = 16000


class FinalizeRequest(BaseModel):
    language: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vosk-stt"}


@app.post("/initialize")
async def initialize(request: InitializeRequest):
    """Initialize Vosk model for a language"""
    try:
        lang_code = request.language.split("-")[0].lower()  # "ru" from "ru-RU"
        
        # Map language codes to model paths
        # You'll need to download models from https://alphacephei.com/vosk/models
        model_paths = {
            "ru": os.getenv("VOSK_MODEL_RU", "./models/vosk-model-ru-0.22"),
            "en": os.getenv("VOSK_MODEL_EN", "./models/vosk-model-en-us-0.22"),
        }
        
        if lang_code not in model_paths:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported language: {request.language}. Supported: ru, en"
            )
        
        model_path = model_paths[lang_code]
        
        if not os.path.exists(model_path):
            raise HTTPException(
                status_code=500,
                detail=f"Model not found at {model_path}. Please download model from https://alphacephei.com/vosk/models"
            )
        
        # Load model if not already loaded
        if lang_code not in models:
            model = vosk.Model(model_path)
            recognizer = vosk.Recognizer(model, 16000)
            recognizers[lang_code] = model
            models[lang_code] = recognizer
            print(f"Loaded Vosk model for language: {lang_code}")
        
        return {"status": "initialized", "language": lang_code}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process")
async def process_audio(request: AudioChunkRequest):
    """Process audio chunk and return transcription"""
    try:
        lang_code = request.language.split("-")[0].lower()
        
        if lang_code not in models:
            raise HTTPException(
                status_code=400,
                detail=f"Model not initialized for language: {request.language}. Call /initialize first."
            )
        
        recognizer = models[lang_code]
        
        # Decode base64 to bytes
        audio_bytes = base64.b64decode(request.chunk)
        
        # Process with Vosk (accepts raw PCM bytes)
        if recognizer.AcceptWaveform(audio_bytes):
            # Final result
            result = json.loads(recognizer.Result())
            if result.get("text"):
                return {
                    "text": result["text"],
                    "is_final": True,
                    "confidence": None,  # Vosk doesn't provide confidence
                }
        else:
            # Partial result
            result = json.loads(recognizer.PartialResult())
            if result.get("partial"):
                return {
                    "text": result["partial"],
                    "is_final": False,
                    "confidence": None,
                }
        
        return {"text": "", "is_final": False}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/finalize")
async def finalize(request: FinalizeRequest):
    """Get final transcription result"""
    try:
        lang_code = request.language.split("-")[0].lower()
        
        if lang_code not in models:
            raise HTTPException(
                status_code=400,
                detail=f"Model not initialized for language: {request.language}"
            )
        
        recognizer = models[lang_code]
        result = json.loads(recognizer.FinalResult())
        
        return {
            "text": result.get("text", ""),
            "is_final": True,
            "confidence": None,
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reset")
async def reset(request: FinalizeRequest):
    """Reset recognizer for a language"""
    try:
        lang_code = request.language.split("-")[0].lower()
        
        if lang_code in models:
            models[lang_code].Reset()
            return {"status": "reset", "language": lang_code}
        
        return {"status": "not_found", "language": lang_code}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)

