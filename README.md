## Write a telegraphic speech based on the idea:

scientist lab late night experiment fail again coffee cold notes scattered breakthrough near feel it data wrong somewhere mystery deep focus sharp deadline tomorrow funding cut fear ignore push forward

Answer:

Scientist in the lab, late night; experiment fails again; coffee is cold; notes scattered; breakthrough feels near; data wrong somewhere; mystery deep; focus sharp; deadline tomorrow; funding cut; fear ignored; push forward.

## Write sentence from Telegraphic speech idea:

A man apple hungry eats 

Answer:

A hungry man eats an apple.


## Use tag-based prompts only. No grammar, no connectives, just core visual/semantic tokens.


Write a telegraphic speech based on the idea:

couple glasses winter coats selfie snow mountains alpine valley chalets blue sky clouds snowing warm smiles

Answer:

Couple in glasses, winter coats, selfie amid snow‑capped mountains, alpine valley, chalets under blue sky, clouds, snowfall, warm smiles.

# Ax Translator — DSPy-like Translation Pipeline

Translate text into clean, understandable language using a DSPy-inspired pipeline powered by NVIDIA GPT-OSS 120B.

## Features

- **3-Stage Pipeline**: Translate → Validate → Refine (DSPy-inspired)
- **Quality Scoring**: Automatic validation with quality score (0-100)
- **Surgical Refinement**: If quality is low, targeted fixes are applied
- **26 Languages**: Including Hindi, Spanish, French, Japanese, Chinese, Arabic, and more
- **Auto-Detect**: Automatic source language detection
- **Session-Only API Key**: Your NVIDIA API key is never stored on the server

## Tech Stack

- **Frontend**: Next.js 16, React 19, shadcn/ui, Tailwind CSS
- **Backend**: Next.js API Routes with embedded pipeline
- **LLM**: NVIDIA GPT-OSS 120B via `integrate.api.nvidia.com`

## Getting Started

### Prerequisites

- Node.js 18+
- npm or bun
- NVIDIA API key from [build.nvidia.com](https://build.nvidia.com/)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/ax-translator.git
cd ax-translator
npm install
npm run dev
```

### Environment Variables

No server-side environment variables required. The NVIDIA API key is provided by the user in the browser UI and passed directly to the API — it's never stored.

If you want to set a default API key (optional):

```bash
# Optional — users can also enter their key in the UI
NVIDIA_API_KEY=nvapi-xxxxx
```

### Deploy to Vercel

1. Push to GitHub
2. Import repo in [vercel.com](https://vercel.com)
3. No environment variables required (API key is user-provided)
4. Deploy!

## How the Pipeline Works

### Stage 1: Translate
NVIDIA GPT-OSS 120B translates your text with a carefully compiled system prompt that preserves meaning and tone.

### Stage 2: Validate
A separate LLM call evaluates accuracy, fluency, completeness, and terminology. Returns a quality score (0-100) and list of issues.

### Stage 3: Refine
If validation finds issues, a surgical fix prompt is compiled (DSPy-style) targeting only the problems. Up to 2 refinements.

## DSPy/Ax Design Principles

- **Signature-based prompt compilation** (`compileTranslatePrompt`)
- **Mode A (initial)**: Empty error history → fresh translation prompt
- **Mode B (surgical fix)**: Latest error + previous attempts → focused fix prompt
- **Workflow never passes raw error history** — only compiled prompts
- **Each step is a discrete, testable activity** (like DSPy Signatures)

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Main translation UI
│   ├── layout.tsx            # App layout & metadata
│   └── api/translate/
│       └── route.ts          # API route (calls pipeline)
├── lib/
│   ├── nvidia-client.ts      # NVIDIA API client
│   └── translation-pipeline.ts  # DSPy-like pipeline
└── components/ui/            # shadcn/ui components
```

## License

MIT
