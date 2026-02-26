"""
STT Service - Python microservice for speech recognition
Supports Vosk and Whisper (faster-whisper) via HTTP API.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import vosk
import json
import os
import base64
import asyncio
import traceback
import ctypes
import time
import numpy as np
from dotenv import load_dotenv
from faster_whisper import WhisperModel

load_dotenv()

app = FastAPI(title="LiveScribe STT Service")
_DLL_DIR_HANDLES = []


def configure_windows_dll_paths() -> None:
    if os.name != "nt":
        return

    cuda_bin_env = os.getenv("CUDA_DLL_DIR")
    cudnn_bin_env = os.getenv("CUDNN_DLL_DIR")

    fallback_cuda_bin = None
    cuda_root = r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"
    if os.path.isdir(cuda_root):
        candidates = [
            os.path.join(cuda_root, name, "bin")
            for name in os.listdir(cuda_root)
            if name.startswith("v12")
        ]
        candidates = [path for path in candidates if os.path.isdir(path)]
        if candidates:
            fallback_cuda_bin = sorted(candidates)[-1]

    dll_dirs = [cuda_bin_env, cudnn_bin_env, fallback_cuda_bin]
    for dll_dir in dll_dirs:
        if not dll_dir:
            continue
        if not os.path.isdir(dll_dir):
            continue
        try:
            os.environ["PATH"] = f"{dll_dir};{os.environ.get('PATH', '')}"
            handle = os.add_dll_directory(dll_dir)
            _DLL_DIR_HANDLES.append(handle)
        except Exception:
            pass


configure_windows_dll_paths()


def validate_windows_cuda_runtime() -> None:
    if os.name != "nt":
        return
    try:
        ctypes.WinDLL("cublas64_12.dll")
        ctypes.WinDLL("cublasLt64_12.dll")
        print("[stt-service][startup] CUDA 12 runtime DLLs loaded")
    except Exception as err:
        print(f"[stt-service][startup] CUDA DLL load failed: {err}")


validate_windows_cuda_runtime()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vosk state
vosk_models: dict[str, vosk.Model] = {}
vosk_recognizers: dict[str, vosk.KaldiRecognizer] = {}

# Whisper shared models (per language) + stream state (per provider instance)
whisper_models: dict[str, WhisperModel] = {}
whisper_states: dict[str, dict] = {}

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_CPU_COMPUTE_TYPE = os.getenv("WHISPER_CPU_COMPUTE_TYPE", "int8")
WHISPER_WINDOW_SECONDS = float(os.getenv("WHISPER_WINDOW_SECONDS", "4.0"))
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
WHISPER_BEST_OF = int(os.getenv("WHISPER_BEST_OF", "5"))
WHISPER_PATIENCE = float(os.getenv("WHISPER_PATIENCE", "1.2"))
WHISPER_TEMPERATURE = float(os.getenv("WHISPER_TEMPERATURE", "0.0"))
WHISPER_VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true"
WHISPER_CONDITION_ON_PREVIOUS_TEXT = (
    os.getenv("WHISPER_CONDITION_ON_PREVIOUS_TEXT", "false").lower() == "true"
)
WHISPER_FORCE_FINAL_SECONDS = float(os.getenv("WHISPER_FORCE_FINAL_SECONDS", "2.0"))
WHISPER_FORCE_FINAL_WORDS = int(os.getenv("WHISPER_FORCE_FINAL_WORDS", "8"))
WHISPER_MIN_FINAL_INTERVAL_SECONDS = float(os.getenv("WHISPER_MIN_FINAL_INTERVAL_SECONDS", "0.8"))


class InitializeRequest(BaseModel):
    language: str
    engine: str = "vosk"
    stream_id: str = "default"


class AudioChunkRequest(BaseModel):
    language: str
    chunk: str
    sample_rate: int = 16000
    engine: str = "vosk"
    stream_id: str = "default"


class FinalizeRequest(BaseModel):
    language: str
    engine: str = "vosk"
    stream_id: str = "default"


def to_lang_code(language: str) -> str:
    return language.split("-")[0].lower()


def decode_audio_chunk(chunk_b64: str) -> bytes:
    try:
        return base64.b64decode(chunk_b64)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio chunk: {err}")


def transcribe_whisper_pcm(
    model: WhisperModel,
    pcm_bytes: bytes,
    lang_code: str,
    sample_rate: int = 16000,
) -> str:
    if not pcm_bytes:
        return ""

    audio_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if audio_int16.size == 0:
        return ""

    audio_float32 = audio_int16.astype(np.float32) / 32768.0
    segments, _info = model.transcribe(
        audio_float32,
        language=lang_code,
        task="transcribe",
        vad_filter=WHISPER_VAD_FILTER,
        beam_size=WHISPER_BEAM_SIZE,
        best_of=WHISPER_BEST_OF,
        patience=WHISPER_PATIENCE,
        temperature=WHISPER_TEMPERATURE,
        without_timestamps=True,
        condition_on_previous_text=WHISPER_CONDITION_ON_PREVIOUS_TEXT,
    )

    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    return text.strip()


def should_emit_whisper_final(text: str, state: dict) -> bool:
    if not text:
        return False

    last_final_text = state.get("last_final_text", "")
    if text == last_final_text:
        return False

    now_ts = time.time()
    last_final_ts = state.get("last_final_ts", 0.0)
    word_count = len([part for part in text.split() if part.strip()])
    last_final_word_count = int(state.get("last_final_word_count", 0))
    word_growth = max(0, word_count - last_final_word_count)
    punctuation_final = text.endswith((".", "!", "?", "…")) and len(text) >= 12
    force_by_time = (now_ts - last_final_ts) >= WHISPER_FORCE_FINAL_SECONDS and word_count >= 3
    force_by_words = (
        word_growth >= WHISPER_FORCE_FINAL_WORDS
        and (now_ts - last_final_ts) >= WHISPER_MIN_FINAL_INTERVAL_SECONDS
    )

    return punctuation_final or force_by_time or force_by_words


def build_incremental_final(previous_full: str, current_full: str) -> str:
    prev = previous_full.strip()
    curr = current_full.strip()
    if not curr:
        return ""
    if not prev:
        return curr

    prev_lower = prev.lower()
    curr_lower = curr.lower()

    if curr_lower.startswith(prev_lower):
        suffix = curr[len(prev):].strip(" ,.!?:;…-")
        return suffix

    if prev_lower.startswith(curr_lower):
        return ""

    prev_words = prev.split()
    curr_words = curr.split()
    common = 0
    limit = min(len(prev_words), len(curr_words))
    while common < limit and prev_words[common].lower() == curr_words[common].lower():
        common += 1

    if common >= 3 and common < len(curr_words):
        return " ".join(curr_words[common:]).strip()

    return curr


@app.get("/health")
async def health():
    return {"status": "ok", "service": "stt-service", "engines": ["vosk", "whisper"]}


@app.post("/initialize")
async def initialize(request: InitializeRequest):
    try:
        lang_code = to_lang_code(request.language)
        engine = request.engine.lower()

        if engine == "vosk":
            model_paths = {
                "ru": os.getenv("VOSK_MODEL_RU", "./models/vosk-model-ru-0.22"),
                "en": os.getenv("VOSK_MODEL_EN", "./models/vosk-model-en-us-0.22"),
            }

            if lang_code not in model_paths:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported language for Vosk: {request.language}. Supported: ru, en",
                )

            model_path = model_paths[lang_code]
            if not os.path.exists(model_path):
                raise HTTPException(status_code=500, detail=f"Vosk model not found at {model_path}")

            if lang_code not in vosk_recognizers:
                model = vosk.Model(model_path)
                recognizer = vosk.KaldiRecognizer(model, 16000)
                vosk_models[lang_code] = model
                vosk_recognizers[lang_code] = recognizer

            return {"status": "initialized", "language": lang_code, "engine": "vosk"}

        if engine == "whisper":
            if lang_code not in whisper_models:
                try:
                    whisper_models[lang_code] = WhisperModel(
                        WHISPER_MODEL_SIZE,
                        device=WHISPER_DEVICE,
                        compute_type=WHISPER_COMPUTE_TYPE,
                    )
                except Exception as err:
                    message = str(err).lower()
                    should_fallback_cpu = (
                        WHISPER_DEVICE in ("auto", "cuda", "gpu")
                        and ("cublas" in message or "cuda" in message or "cudnn" in message)
                    )
                    should_fallback_cpu_compute = (
                        WHISPER_DEVICE in ("cpu", "auto")
                        and ("float16" in message or "do not support efficient float16" in message)
                    )
                    if not (should_fallback_cpu or should_fallback_cpu_compute):
                        raise

                    print(
                        "[stt-service][initialize][whisper] fallback to CPU "
                        f"(compute_type={WHISPER_CPU_COMPUTE_TYPE})"
                    )
                    whisper_models[lang_code] = WhisperModel(
                        WHISPER_MODEL_SIZE,
                        device="cpu",
                        compute_type=WHISPER_CPU_COMPUTE_TYPE,
                    )

            stream_id = request.stream_id or "default"
            whisper_states[stream_id] = {
                "language": lang_code,
                "buffer": bytearray(),
                "last_partial": "",
                "lock": asyncio.Lock(),
                "last_final_text": "",
                "last_final_ts": 0.0,
                "last_final_word_count": 0,
            }

            return {
                "status": "initialized",
                "language": lang_code,
                "engine": "whisper",
                "model": WHISPER_MODEL_SIZE,
                "stream_id": stream_id,
            }

        raise HTTPException(status_code=400, detail=f"Unsupported engine: {request.engine}")
    except HTTPException:
        raise
    except Exception as err:
        print(f"[stt-service][initialize][{request.engine}] error: {err}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(err))


@app.post("/process")
async def process_audio(request: AudioChunkRequest):
    try:
        lang_code = to_lang_code(request.language)
        engine = request.engine.lower()
        audio_bytes = decode_audio_chunk(request.chunk)

        if engine == "vosk":
            if lang_code not in vosk_recognizers:
                raise HTTPException(
                    status_code=400,
                    detail=f"Vosk not initialized for language: {request.language}",
                )

            recognizer = vosk_recognizers[lang_code]
            if recognizer.AcceptWaveform(audio_bytes):
                result = json.loads(recognizer.Result())
                if result.get("text"):
                    return {"text": result["text"], "is_final": True, "confidence": None}
            else:
                result = json.loads(recognizer.PartialResult())
                if result.get("partial"):
                    return {"text": result["partial"], "is_final": False, "confidence": None}

            return {"text": "", "is_final": False}

        if engine == "whisper":
            if lang_code not in whisper_models:
                raise HTTPException(
                    status_code=400,
                    detail=f"Whisper not initialized for language: {request.language}",
                )

            stream_id = request.stream_id or "default"
            state = whisper_states.get(stream_id)
            if not state:
                raise HTTPException(
                    status_code=400,
                    detail=f"Whisper stream not initialized: {stream_id}",
                )

            if state["language"] != lang_code:
                raise HTTPException(
                    status_code=400,
                    detail=f"Whisper stream language mismatch for stream {stream_id}",
                )

            state["buffer"].extend(audio_bytes)
            total_bytes = len(state["buffer"])
            bytes_per_sec = request.sample_rate * 2
            min_bytes = int(WHISPER_WINDOW_SECONDS * bytes_per_sec)

            if total_bytes < min_bytes:
                return {"text": "", "is_final": False}

            window = bytes(state["buffer"][-min_bytes:])
            lock = state["lock"]
            async with lock:
                text = transcribe_whisper_pcm(
                    whisper_models[lang_code], window, lang_code, request.sample_rate
                )

            previous = state["last_partial"]
            if not text or text == previous:
                return {"text": "", "is_final": False}

            state["last_partial"] = text
            if should_emit_whisper_final(text, state):
                incremental = build_incremental_final(state["last_final_text"], text)
                if not incremental:
                    return {"text": "", "is_final": False}

                state["last_final_text"] = text
                state["last_final_ts"] = time.time()
                state["last_final_word_count"] = len([part for part in text.split() if part.strip()])
                return {"text": incremental, "is_final": True, "confidence": None}

            return {"text": text, "is_final": False, "confidence": None}

        raise HTTPException(status_code=400, detail=f"Unsupported engine: {request.engine}")
    except HTTPException:
        raise
    except Exception as err:
        print(f"[stt-service][process][{request.engine}] error: {err}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(err))


@app.post("/finalize")
async def finalize(request: FinalizeRequest):
    try:
        lang_code = to_lang_code(request.language)
        engine = request.engine.lower()

        if engine == "vosk":
            if lang_code not in vosk_recognizers:
                raise HTTPException(
                    status_code=400,
                    detail=f"Vosk not initialized for language: {request.language}",
                )

            recognizer = vosk_recognizers[lang_code]
            result = json.loads(recognizer.FinalResult())
            return {"text": result.get("text", ""), "is_final": True, "confidence": None}

        if engine == "whisper":
            if lang_code not in whisper_models:
                raise HTTPException(
                    status_code=400,
                    detail=f"Whisper not initialized for language: {request.language}",
                )

            stream_id = request.stream_id or "default"
            state = whisper_states.get(stream_id)
            if not state:
                return {"text": "", "is_final": True, "confidence": None}

            if state["language"] != lang_code:
                raise HTTPException(
                    status_code=400,
                    detail=f"Whisper stream language mismatch for stream {stream_id}",
                )

            buffered = bytes(state["buffer"])
            lock = state["lock"]
            async with lock:
                text = transcribe_whisper_pcm(whisper_models[lang_code], buffered, lang_code)

            return {"text": text, "is_final": True, "confidence": None}

        raise HTTPException(status_code=400, detail=f"Unsupported engine: {request.engine}")
    except HTTPException:
        raise
    except Exception as err:
        print(f"[stt-service][finalize][{request.engine}] error: {err}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(err))


@app.post("/reset")
async def reset(request: FinalizeRequest):
    try:
        lang_code = to_lang_code(request.language)
        engine = request.engine.lower()

        if engine == "vosk":
            if lang_code in vosk_recognizers:
                vosk_recognizers[lang_code].Reset()
                return {"status": "reset", "language": lang_code, "engine": "vosk"}
            return {"status": "not_found", "language": lang_code, "engine": "vosk"}

        if engine == "whisper":
            stream_id = request.stream_id or "default"
            whisper_states.pop(stream_id, None)
            return {"status": "reset", "language": lang_code, "engine": "whisper"}

        raise HTTPException(status_code=400, detail=f"Unsupported engine: {request.engine}")
    except HTTPException:
        raise
    except Exception as err:
        print(f"[stt-service][reset][{request.engine}] error: {err}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(err))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3002)
