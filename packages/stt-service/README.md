# STT Service (Python)

Python microservice for Vosk speech recognition.

## Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Download Vosk models:
```bash
# Create models directory
mkdir -p models

# Download Russian model (example)
wget https://alphacephei.com/vosk/models/vosk-model-ru-0.22.zip
unzip vosk-model-ru-0.22.zip -d models/

# Download English model (example)
wget https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip
unzip vosk-model-en-us-0.22.zip -d models/
```

3. Set model paths (optional, if models are in different location):
```bash
export VOSK_MODEL_RU=./models/vosk-model-ru-0.22
export VOSK_MODEL_EN=./models/vosk-model-en-us-0.22
```

4. Run service:
```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 3002
```

Service will run on `http://localhost:3002`

## API Endpoints

- `POST /initialize` - Initialize model for language
- `POST /process` - Process audio chunk
- `POST /finalize` - Get final result
- `POST /reset` - Reset recognizer
- `GET /health` - Health check

## Integration with Node.js

Node.js backend calls this service via HTTP. See `packages/backend/src/stt/vosk-http.ts`

