# Ax Translator

Test with example to solve a complex thinking

## AX DSPy Pipeline

The translation pipeline is derived from the [atomic-graph-opencode](https://github.com/zazikant/atomic-graph-opencode) AX DSPy reference implementation, while serving this repo's output contract (`translatedText` + `qualityScore` 0-100) and its NVIDIA transport + SSE streaming architecture.

The JSON-validate stage (and the validate → refine → revalidate loop) was **removed on purpose**: the JSON self-critique step could silently retry/loop on JSON parsing, adding long invisible waits before any output appeared. Translation now runs a single pass and streams directly:

```
1. TRANSLATE → translated text   (stage temperature 0.3, dynamic max_tokens)
   → streams token-by-token to the browser (SSE)
   echo guard: if the model echoed the input unchanged,
   one forceful retry with the anti-echo prompt
```

Kept patterns:

- **Stage-specific system prompts** — `TRANSLATE_SYSTEM_PROMPT`, `TRANSLATE_RETRY_SYSTEM_PROMPT`, `CROSS_LANGUAGE_SYSTEM_PROMPT`, `CROSS_LANGUAGE_RETRY_SYSTEM_PROMPT` (mirrors the Bible repo's EXTRACT / EXTRACT_RETRY prompts with their CRITICAL OUTPUT RULES blocks)
- **buildTranslatePrompts()** — single source of truth for translate-stage prompts, shared word-to-word by the non-streaming pipeline AND the streaming fast path (`/api/translate-stream`)
- **Echo detection** — >80% input overlap detection with forceful retry prompt (cross-language mode), applied in both the non-streaming pipeline and the streaming fast path
- **Stage-specific temperature** — translate=0.3
- **Stage-based calculateMaxTokens** — translate 2048-32768 (same-language transformation keeps the 4× multiplier; values above gpt-oss-20b's 4096-token per-call cap are handled by nvidia-client's auto-continue loop)
- **No JSON-validate stage** — no JSON parsing, no silent retry/loop; failures surface immediately

## Write a telegraphic speech based on the idea::

scientist lab late night experiment fail again coffee cold notes scattered breakthrough near feel it data wrong somewhere mystery deep focus sharp deadline tomorrow funding cut fear ignore push forward

Answer:

Scientist in the lab, late night; experiment fails again; coffee is cold; notes scattered; breakthrough feels near; data wrong somewhere; mystery deep; focus sharp; deadline tomorrow; funding cut; fear ignored; push forward.


## Use tag-based prompts only. No grammar, no connectives, just core visual/semantic tokens::


Write a telegraphic speech based on the idea:

couple glasses winter coats selfie snow mountains alpine valley chalets blue sky clouds snowing warm smiles

Answer:

Couple in glasses, winter coats, selfie amid snow‑capped mountains, alpine valley, chalets under blue sky, clouds, snowfall, warm smiles.

## Extract only action items::

The team needs to finish the report, schedule a meeting, and send invoices by Friday

- Finish the report  
- Schedule a meeting  
- Send invoices by Friday

## Write sentence from Telegraphic speech idea::

A man apple hungry eats 

Answer:

A hungry man eats an apple.

## Compress to keywords:

The economy is struggling due to inflation

economy, inflation, struggling

## Convert telegraphic notes into a formal essay.  Preserve Facts, headings, subheadings, bullet points.  Add Argumentative connectives and logical flow. Style Formal, academic, polished.Input::
this is standalone prompt not to be combined with any above 

## Write a telegraphic speech about:: 

Climate change

Rising temperatures; melting ice caps; extreme weather spikes.  
CO₂ emissions soaring; fossil fuels dominate; oceans acidify.  
Deforestation accelerates; biodiversity collapses; sea levels climb.  
Urgent action required: slash emissions, shift to renewables, reforest, enforce climate policies.  
Future of humanity hangs in the balance.

## Write a comedy telegraphic speech about::

Man going to restaurant

Man: starving. Enters restaurant. Waiter: menu. Man: eyes menu, brain: “food?” Orders steak, medium‑rare. Waiter: “how you want it?” Man: “like my ex—well done.” Plate arrives. Man: “is this a joke?” Fork: “no, it’s me.” Soup: “I’m too hot for this.” Bill arrives. Man: “pay with jokes?” Cashier: “only laughs accepted.” Man leaves, satisfied, stomach full, ego slightly bruised.

# Ax Translator — DSPy-like Translation Pipeline

Translate text into clean, understandable language using a DSPy-inspired pipeline powered by NVIDIA GPT-OSS 20B.

## Features

- **Direct Streaming**: Translation streams token-by-token to the browser (SSE) — single translate pass, no JSON-validate round-trips
- **Echo Guard**: If the model echoes the input instead of translating, one forceful retry with the anti-echo prompt
- **26 Languages**: Including Hindi, Spanish, French, Japanese, Chinese, Arabic, and more
- **Default Source: English**: The "From" dropdown defaults to English (Auto Detect is hidden from the UI)
- **Server-Side API Key**: NVIDIA API key is read from the `NVIDIA_API_KEY` environment variable on Vercel — never sent from the browser

## Tech Stack

- **Frontend**: Next.js 16, React 19, shadcn/ui, Tailwind CSS
- **Backend**: Next.js API Routes with embedded pipeline
- **LLM**: NVIDIA GPT-OSS 20B (`openai/gpt-oss-20b`) via `integrate.api.nvidia.com`

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

The NVIDIA API key **must** be set as a server-side environment variable (it is no longer collected from the browser UI).

Get an API key from [build.nvidia.com](https://build.nvidia.com/), then configure it in Vercel:

- Vercel Dashboard → your project → **Settings → Environment Variables**
- Key: `NVIDIA_API_KEY`
- Value: `nvapi-xxxxx`
- Select the environments (Production / Preview / Development)

For local development, create a `.env` file (already in `.gitignore`):

```bash
NVIDIA_API_KEY=nvapi-xxxxx
```

### Deploy to Vercel

1. Push to GitHub
2. Import repo in [vercel.com](https://vercel.com)
3. Add the `NVIDIA_API_KEY` environment variable in Project Settings (see below)
4. Deploy!

## How the Pipeline Works

### Single Pass: Translate
NVIDIA GPT-OSS 20B translates your text with a carefully compiled system prompt that preserves meaning and tone, and the output streams token-by-token to the browser. The model has a 4096-token output limit per call, but the auto-continue loop in the NVIDIA client transparently chains multiple calls to produce longer outputs — the user sees continuous token streaming with no visible boundary between calls.

There is no validate/refine stage: a JSON-validate step that could silently retry/loop was removed so translation always streams directly. If the model echoes the input instead of translating (cross-language mode), one forceful retry with the anti-echo prompt is attempted.

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
