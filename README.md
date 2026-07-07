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

Translate text into clean, understandable language using a DSPy-inspired pipeline powered by NVIDIA GPT-OSS 120B.

## Features

- **3-Stage Pipeline**: Translate → Validate → Refine (DSPy-inspired)
- **Quality Scoring**: Automatic validation with quality score (0-100)
- **Surgical Refinement**: If quality is low, targeted fixes are applied
- **26 Languages**: Including Hindi, Spanish, French, Japanese, Chinese, Arabic, and more
- **Default Source: English**: The "From" dropdown defaults to English (Auto Detect is hidden from the UI)
- **Server-Side API Key**: NVIDIA API key is read from the `NVIDIA_API_KEY` environment variable on Vercel — never sent from the browser

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
