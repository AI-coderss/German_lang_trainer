
# Patient AI Assistant

A voice-first and chat-first assistant that helps patients and visitors **navigate the hospital**, find **clinics**, **inpatient rooms**, and **key desks**—all from the web. It includes a **low-latency voice assistant** (WebRTC + OpenAI Realtime) and a **streaming text chat** UI, with a clean, responsive interface and a pragmatic backend that feeds the model a curated **location directory** (system prompt) built from hospital PDFs.

> Live modes:
> • **Voice Assistant** (WebRTC, mic toggle, orb + audio wave visualizers)
> • **Text Chat** (streaming Markdown, Mermaid diagrams)
> • **Avatar** (placeholder 3D avatar component/page, optional)

---

## Table of contents

* [Features](#features)
* [Architecture](#architecture)
* [Project structure](#project-structure)
* [Frontend](#frontend)
* [Backend](#backend)
* [System prompt & data sources](#system-prompt--data-sources)
* [Environment variables](#environment-variables)
* [Local development](#local-development)
* [Build & deploy](#build--deploy)
* [How it works (flows)](#how-it-works-flows)
* [Theming](#theming)
* [Accessibility](#accessibility)
* [Security & privacy](#security--privacy)
* [API contracts](#api-contracts)
* [Extensibility](#extensibility)
* [Limitations & roadmap](#limitations--roadmap)
* [License](#license)

---

## Features

* **Hospital navigation**: step-by-step guidance to Eye, Dental, Pediatrics, Orthopedics, ENT, Urology, Surgery, Cardiology, Infertility, Day Surgery, Pre-Op, ED, Pharmacies, Cafés, Golden Services, Medical Records, Radiology, Laundry, Admission/Discharge, and **inpatient rooms (5F–7F)**.
* **Two interaction modes**:

  * **Voice mode** (WebRTC + OpenAI Realtime): press the mic; talk to the assistant; get instant speech replies; audio wave + orb visualizations.
  * **Text chat**: type; receive streaming Markdown responses (with Mermaid diagrams when present).
* **Clean, responsive UI**: desktop, tablets, and phones; pixel-smooth mic toggle; centered orb and wave with proper spacing; no layout jank.
* **Theme-ready**: light/dark theming switch (cyan accent in dark); for now the app flips background color; the rest of the palette is easy to extend.
* **Production-savvy**: SSE/stream handling, audio level monitoring, graceful teardown of WebRTC/mic streams, mobile safe-areas, reduced motion for low-end devices.
* **Prompt-driven**: a single **system prompt** (backend) constrains the assistant to the hospital directory; avoids medical advice; includes safety guidance.

---

## Architecture

```
Frontend (React, Vite or CRA)
 ├─ VoiceAssistant.jsx  (WebRTC, mic, orb, audio wave)
 │   └─ connects → Voice WebRTC Signaling Service  (OpenAI Realtime)
 ├─ Chat.jsx           (streaming text UI)
 │   └─ POST /stream → Backend → OpenAI Chat/Responses (SSE-like)
 ├─ Navbar.jsx         (routing, theme toggle)
 ├─ Avatar3D.jsx       (optional page/component)
 └─ Styles (CSS modules)

Backend (Python or Node)* 
 ├─ prompts/system_prompt.py  (Patient AI Assistant directive & directory)
 ├─ /routes (e.g., /stream, /suggestions)
 ├─ [optional] time service wrapper (Time API)
 └─ PDF ingestion (manual/offline) → prompt content
```

\* The repo’s backend examples reference Python (`prompts/system_prompt.py`). Your server may be Python (FastAPI/Flask) or Node (Express), as long as it exposes the documented endpoints.

---

## Project structure

```
.
├─ frontend/
│  ├─ src/
│  │  ├─ App.jsx
│  │  ├─ App.css
│  │  ├─ components/
│  │  │  ├─ Navbar.jsx
│  │  │  ├─ VoiceAssistant.jsx
│  │  │  ├─ Chat.jsx
│  │  │  ├─ Avatar3D.jsx
│  │  │  ├─ AudioWave.jsx
│  │  │  ├─ BaseOrb.jsx
│  │  │  ├─ Mermaid.jsx
│  │  │  ├─ ChatInputWidget.jsx
│  │  │  ├─ BaseOrb.css
│  │  │  ├─ AudioWave.css
│  │  ├─ pages/
│  │  │  └─ VoiceAssistantPage.jsx
│  │  ├─ store/
│  │  │  ├─ useAudioForVisualizerStore.js
│  │  │  └─ audioStore.js
│  │  ├─ styles/
│  │  │  ├─ Navbar.css
│  │  │  ├─ chat.css
│  │  │  └─ voiceassistant.css
│  │  ├─ utils/
│  │  │  ├─ pcmToWav.js
│  │  │  └─ audioLevelAnalyzer.js
│  │  └─ assets/ (logo.png, nav.wav, avatar gif, etc.)
│  └─ index.html
│
└─ backend/
   ├─ prompts/
   │  └─ system_prompt.py
   ├─ server.py (or app.py / main.py)*
   ├─ requirements.txt*
   └─ .env.example
```

---

## Frontend

* **React Router** routes:

  * `/voice-assistant` → `VoiceAssistantPage` (uses `VoiceAssistant.jsx`)
  * `/text-chat` → Chat page (`Chat.jsx`)
  * `/avatar` → Avatar page (`Avatar3D.jsx`)
* **Navbar**: sleek, hover effects, active link underline, mobile drawer, theme toggle (stores choice in `localStorage`, writes `data-theme` on `<html>`).
* **VoiceAssistant**:

  * WebRTC to the signaling server (`/api/rtc-connect`) for OpenAI Realtime.
  * Mic button (green = active, red with slash = inactive), centered at bottom; connection state banner.
  * `BaseOrb` (canvas particle orb) reads CSS theme vars; `AudioWave` renders a multi-wave FFT canvas.
* **Chat**:

  * Streaming bot replies via `fetch` + `ReadableStream` from backend `/stream`.
  * Markdown rendering (`react-markdown`, `remark-gfm`), Mermaid blocks via `Mermaid.jsx`.
  * Suggestions sidebar (desktop) and accordion (mobile).
* **State**:

  * `useAudioForVisualizerStore` (audio energy for orb/wave).
  * `audioStore` (current audio stream URL/control).

---

## Backend

* **System prompt** (Python): `backend/prompts/system_prompt.py`

  * Persona: “Patient AI Assistant”—answers only from the **Location Directory**.
  * Safety: no medical advice; emergency redirection; short, stepwise voice-friendly directions.
  * Directory: distilled from provided PDFs (first floor clinics, ground floor services, basement, inpatient floors).
* **Endpoints (expected)**:

  * `POST /stream` – text chat; returns streamed model output (SSE-like chunked text).
    Inputs: `{ message, session_id }`.
    Output: text chunks (the frontend concatenates).
  * `GET /suggestions` – returns `{ suggested_questions: [] }` for the chat UI.
  * **Voice signaling**: frontend calls `POST https://voiceassistant-mode-webrtc-server.onrender.com/api/rtc-connect`
    The signaling service negotiates OpenAI Realtime and returns an SDP answer.
* **OpenAI usage**:

  * **Text**: use Chat Completions or Responses API; stream tokens back to the client.
  * **Voice**: OpenAI **Realtime API** via WebRTC (data channel events like `response.audio.delta`, `response.create`).
* **Time API (optional)**:

  * Add a simple wrapper (e.g., `services/time.py`) to fetch current time (for timestamps, greetings, or time-gated logic) from a configurable URL (e.g., WorldTimeAPI or internal time service). The README includes env keys for this; you can wire it into responses if you need time-aware behavior.

---

## System prompt & data sources

The **system prompt** bundles a curated **Location Directory** (English), extracted and normalized from uploaded hospital PDFs (first floor, ground/G, basement/B, inpatient floors). The assistant:

* Confirms the starting point (**Main Gate** vs **Outpatient Clinics Gate**) and landmarks (e.g., **Nahdi Pharmacy**).
* Gives **floor** + **elevator numbers** and **short steps**.
* Politely declines medical advice and redirects urgent issues to **Emergency Department**.

> You can update `prompts/system_prompt.py` to add/edit locations or translate entries.

---

## Environment variables

Create `.env` files for both frontend and backend.

**Backend (`backend/.env`)**

```
# OpenAI
OPENAI_API_KEY=sk-...
QDRANT_HOST=gpt-4o-mini    # or latest
QDRANT_API_KEY=....
COLLECTION_NAME=


# CORS
ALLOWED_ORIGINS=https://your-frontend.example.com,http://localhost:5173

> Keep keys out of the frontend where possible (voice signaling should be server-side if you own the signaling service).

---

## Local development

**Prerequisites**

* Node 18+ and npm / pnpm / yarn
* Python 3.10+ (if your backend is Python)
* FFmpeg (optional, only if you process audio server-side)

**Install & run**

Frontend:

```bash
cd frontend
npm i
npm run start
# Vite dev server starts (usually http://localhost:5173)
```

Backend (Python example):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 5050
# exposes /stream and /suggestions
```

---

## Build & deploy

Frontend:

```bash
cd frontend
npm run build
# outputs to dist/ — deploy to Vercel/Netlify/S3+CloudFront/etc.
```

Backend:

* Deploy to Render/Fly/Heroku/AWS Lambda + API Gateway (ensure streaming is enabled; some hosts buffer responses by default).
* Set env vars and CORS to allow your frontend origin.

Voice signaling:

* If you host your own, deploy the WebRTC signaling service behind TLS (wss/https) and configure CORS/ICE servers.
* The example uses a hosted endpoint: `onrender.com/api/rtc-connect`.

---

## How it works (flows)

**Text chat**

1. User types → frontend `POST /stream` with `{ message, session_id }`.
2. Backend assembles messages (adds **SYSTEM\_PROMPT**) → calls OpenAI **streaming** API.
3. Backend forwards chunks to the browser; UI shows incremental Markdown.

**Voice assistant**

1. User taps mic → frontend requests `getUserMedia({ audio: true })`.
2. Frontend builds a `RTCPeerConnection`, adds the mic track, opens a data channel.
3. Frontend creates an offer and `POST`s SDP to **RTC signaling**; gets an answer.
4. OpenAI Realtime streams audio (`response.audio.delta`, `response.audio.done`) via data channel.
5. UI renders the **orb** (audio energy) and **AudioWave**; mic button toggles enable/disable.

---

## Theming

* Navbar toggle sets `data-theme="light" | "dark"` on `<html>`.
* For now, the app **only flips the page background** (per your requirement).
* The orb and wave read CSS variables so you can extend theme colors later without code changes.

---

## Accessibility

* Mic button has `aria-pressed`, `aria-label`, and clear color states.
* Keyboard users can navigate Navbar links and toggles.
* Animations are minimized on mobile and can be reduced system-wide (respect `prefers-reduced-motion` if you enable that in styles).

---

## Security & privacy

* Never log PHI/PII.
* Strip personal data from analytics.
* Enable CORS narrowly (`ALLOWED_ORIGINS`).
* Prefer **server-side** OpenAI calls (don’t expose API keys client-side).
* Handle media permissions carefully; stop tracks on unmount; close PC/datachannels on teardown.

---

## API contracts

**GET `/suggestions`**
Response:

```json
{ "suggested_questions": ["Where is Eye Clinic?", "How to reach Radiology?"] }
```

**POST `/stream`**
Request:

```json
{ "message": "Directions to Pediatrics from Main Gate", "session_id": "uuid" }
```

Response: `text/plain` streamed chunks (concatenate in UI).

**POST `/api/rtc-connect`** (voice signaling; currently hosted)
Request: `Content-Type: application/sdp`, body: **offer.sdp**
Response: **answer.sdp** (plain text)

**\[Optional] GET Time API**
`TIME_API_URL` returns JSON; your backend can inject time context into greetings if desired.

---

## Extensibility

* **Add clinics/rooms**: edit `backend/prompts/system_prompt.py` Location Directory.
* **Bilingual**: add an Arabic section to the prompt and auto-detect user language (from browser or explicit toggle).
* **Analytics**: capture route popularity (anonymous) to improve signage and UI hints.
* **Kiosk mode**: run on tablets at entrance with auto-start voice & large controls.
* **On-device wake word**: integrate VAD/keyword spotting for hands-free flow.

---

## Limitations & roadmap

* The assistant intentionally **does not** give medical advice; it only routes/navigates.
* Voice signaling is currently pointed at a hosted endpoint—self-host for maximum control.
* Time API is optional and off by default; wire it in if you need time-aware messages.
* Theme toggle currently changes **background**; full palette theming is easy to enable.

---

## License

Choose what fits your organization (MIT, Apache-2.0, internal only). Add a `LICENSE` file accordingly.

---

If you want, I can add **copy-paste snippets** for a FastAPI or Express backend that implement `/stream` and `/suggestions` exactly as the front-end expects, plus a tiny Time API wrapper.

