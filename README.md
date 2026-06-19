# AI Answer Assistant

A Chrome extension that automatically detects and answers quiz questions using AI — works on any webpage, from Google Forms to Quizizz and custom quiz platforms.

The extension scans the DOM for question blocks (radio groups, checkboxes, buttons, selects, text inputs), sends them to an AI provider, and injects the answers back into the page.

## Features

- **Works on any quiz platform** — detects native form elements (`<input>`, `<select>`, `<textarea>`) and custom button-based UIs (Quizizz, Kahoot, etc.)
- **Dual AI provider support** — use your local LLM via the built-in FastAPI backend, or call the OpenAI API directly from the extension
- **One-click answering** — Detect → Answer All, with visual highlights showing detected questions
- **Minimal user setup** — just install the extension, configure your provider, and go
- **Local-first** — your API keys stay in Chrome storage; no external servers needed for OpenAI mode

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│  Chrome Extension   │  HTTP   │  Local Backend        │
│  (Popup + Content)  │ ──────→ │  (FastAPI :8765)      │ ──→ Ollama / vLLM
│                     │         └──────────────────────┘
│  or                 │
│                     │  HTTPS
│                     │ ──────→  OpenAI API
└─────────────────────┘
```

## Project Structure

```
ai-answer-assistant/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json        # Extension manifest
│   ├── background.js        # Message routing + API dispatch
│   ├── content.js           # DOM question detection + answer injection
│   ├── content.css          # Highlight/badge styles
│   ├── popup.html           # Popup UI
│   ├── popup.js             # Popup logic + settings
│   └── icons/               # Extension icons (16/48/128px)
├── backend/                 # Optional local FastAPI backend
│   ├── server.py            # API server + LLM prompt builder
│   └── requirements.txt     # Python dependencies
└── test-quiz.html           # Sample test page with 6 question types
```

## Quick Start

### Option 1: Chrome Extension + OpenAI API (simplest)

1. Go to `chrome://extensions`, enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` folder
3. Click the extension icon, switch provider to **OpenAI API**
4. Enter your API key and model
5. Navigate to any quiz page, click **Detect Questions** → **Answer All**

### Option 2: Chrome Extension + Local Backend

**Step 1: Start the backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Edit LLM_BASE_URL and LLM_MODEL in server.py to match your setup
python server.py
# Starts on http://localhost:8765
```

The backend defaults to Ollama (`http://localhost:11434`) with `llama3.2`. Adjust `LLM_BASE_URL` and `LLM_MODEL` at the top of `server.py` for your local LLM.

**Step 2: Load the extension**

1. Go to `chrome://extensions`, enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` folder
3. Keep the provider set to **Local Backend** (default)
4. The status dot should turn green if the backend is reachable

**Step 3: Use it**

1. Navigate to any quiz page (or open `test-quiz.html` in Chrome)
   - For `file://` URLs: enable **Allow access to file URLs** in the extension settings
2. Click the extension icon → **Detect Questions**
3. Review the highlighted question blocks → **Answer All**

## Supported Question Types

| Type | Detection | Example |
|------|-----------|---------|
| Multiple choice | `<input type="radio">` groups, `button[role="option"]` groups | Standard quizzes, Quizizz |
| Checkbox | `<input type="checkbox">` groups | "Select all that apply" |
| Dropdown | `<select>` elements | Year, country selectors |
| Text input | `<input type="text">`, `<textarea>` | Short answer, fill-in-blank |

The AI is prompted to respond with option letters (A, B, C...) for choice questions and exact text for free-text questions.

## Backend API

If using the local backend, these endpoints are available:

### `GET /api/health`
Health check.

```bash
curl http://localhost:8765/api/health
# → {"status":"ok"}
```

### `POST /api/answer`
Answer quiz questions.

```bash
curl -X POST http://localhost:8765/api/answer \
  -H "Content-Type: application/json" \
  -d '{
    "questions": [
      {
        "id": "q0",
        "type": "multiple_choice",
        "text": "What is the capital of France?",
        "options": ["London", "Paris", "Berlin", "Madrid"]
      }
    ]
  }'
# → {"answers":[{"id":"q0","answer":"B"}]}
```

The backend supports both OpenAI-compatible (`/v1/chat/completions`) and Ollama (`/api/generate`) APIs as fallback.

## Configuration

All extension settings are stored in Chrome's local storage and persist across sessions:

- **Provider**: `local` (FastAPI backend) or `openai` (OpenAI API)
- **Backend URL**: URL of your local FastAPI server (default: `http://localhost:8765`)
- **API Key**: OpenAI-compatible API key
- **Base URL**: OpenAI API endpoint (default: `https://api.openai.com`, works with Azure, Groq, etc.)
- **Model**: Model name (default: `gpt-4o`)

## Requirements

- **Chrome** 88+ (Manifest V3)
- **Python** 3.10+ (only for the optional local backend)
- **AI Provider**: either an OpenAI-compatible API key or a local LLM (Ollama, vLLM, LM Studio, etc.)

## License

MIT
