# STT Service (Python)

Python microservice used by backend HTTP STT providers.

Supported engines:
- `vosk` (offline, lightweight, lower accuracy)
- `whisper` via `faster-whisper` (offline, higher quality, heavier)

## Quick Start

### 1) Create venv and install dependencies

```bash
cd packages/stt-service
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

### 2) Run service

```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 3002
```

Service URL: `http://127.0.0.1:3002`

## Whisper Runtime: CPU vs GPU

### CPU mode (stable default)

`packages/stt-service/.env`:

```env
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_COMPUTE_TYPE=int8
WHISPER_MODEL_SIZE=small
WHISPER_WINDOW_SECONDS=4.0
```

### GPU mode (NVIDIA)

Requirements for current `faster-whisper/ctranslate2` stack:
- CUDA **12.x** runtime (must provide `cublas64_12.dll`)
- cuDNN compatible with CUDA 12 (DLLs available to process)

`packages/stt-service/.env`:

```env
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
WHISPER_CPU_COMPUTE_TYPE=int8
WHISPER_MODEL_SIZE=small
WHISPER_WINDOW_SECONDS=4.0
```

Optional explicit DLL paths on Windows:

```env
CUDA_DLL_DIR=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin
CUDNN_DLL_DIR=C:\path\to\cudnn\bin
```

Service validates CUDA DLL loading at startup and logs status.

## Whisper Quality/Latency Tuning

Tune in `.env`:

```env
WHISPER_MODEL_SIZE=small|medium
WHISPER_WINDOW_SECONDS=4.0
WHISPER_BEAM_SIZE=2
WHISPER_BEST_OF=2
WHISPER_PATIENCE=1.0
WHISPER_TEMPERATURE=0.0
WHISPER_VAD_FILTER=true
WHISPER_CONDITION_ON_PREVIOUS_TEXT=false
```

Heavier but more accurate example:

```env
WHISPER_MODEL_SIZE=medium
WHISPER_WINDOW_SECONDS=6.0
WHISPER_BEAM_SIZE=5
WHISPER_BEST_OF=5
WHISPER_PATIENCE=1.2
```

## Final/Partial Behavior

Whisper in this service emits:
- frequent `partial` updates for live text
- controlled `final` updates (time/word/punctuation-based) for UI stabilization
- incremental final chunks to reduce duplicated repeated text

## API

- `POST /initialize`
- `POST /process`
- `POST /finalize`
- `POST /reset`
- `GET /health`

POST body supports:
- `language` (e.g. `ru-RU`, `en-US`)
- `engine` (`vosk` or `whisper`)
- `stream_id` (important for per-track Whisper isolation)

`/process` additionally expects:
- `chunk` (base64 PCM int16, 16kHz mono)
- `sample_rate` (default `16000`)

## Integration with backend

- Backend `STT_PROVIDER=vosk` -> service with `engine=vosk`
- Backend `STT_PROVIDER=whisper` -> service with `engine=whisper`
