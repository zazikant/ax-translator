'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Languages,
  Key,
  ArrowRightLeft,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Zap,
  RefreshCw,
  History,
  Info,
  Download,
  ChevronDown,
} from 'lucide-react';

// ─── Language Options ────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'ar', label: 'Arabic' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'pl', label: 'Polish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'bn', label: 'Bengali' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'pa', label: 'Punjabi' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface TranslationResult {
  translatedText: string;
  qualityScore: number;
  attempts: number;
  refinements: number;
  issues?: string[];
  model: string;
  pipeline?: string[];
}

interface HistoryEntry {
  id: string;
  input: string;
  sourceLanguage: string;
  targetLanguage: string;
  result: TranslationResult;
  timestamp: number;
}

// ─── Examples ─────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    title: 'Telegraphic Speech (Basic)',
    prompt: `Write a telegraphic speech based on the idea::
scientist lab late night experiment fail again coffee cold notes scattered breakthrough near feel it data wrong somewhere mystery deep focus sharp deadline tomorrow funding cut fear ignore push forward`,
    answer: `Scientist in the lab, late night; experiment fails again; coffee is cold; notes scattered; breakthrough feels near; data wrong somewhere; mystery deep; focus sharp; deadline tomorrow; funding cut; fear ignored; push forward.`,
  },
  {
    title: 'Tag-Based Prompts',
    prompt: `Use tag-based prompts only. No grammar, no connectives, double colon separator, just core visual/semantic tokens ::\n  ::\ncouple glasses winter coats selfie snow mountains alpine valley chalets blue sky clouds snowing warm smiles`,
    answer: `couple :: glasses :: winter coats :: selfie :: snow mountains :: alpine valley :: chalets :: blue sky :: clouds :: snowing :: warm smiles`,
  },
  {
    title: 'Extract Action Items',
    prompt: `Extract only action items::
The team needs to finish the report, schedule a meeting, and send invoices by Friday`,
    answer: `- Finish the report
- Schedule a meeting
- Send invoices by Friday`,
  },
  {
    title: 'Sentence from Telegraphic Speech',
    prompt: `Write sentence from Telegraphic speech idea::
A man apple hungry eats`,
    answer: `A hungry man eats an apple.`,
  },
  {
    title: 'Compress to Keywords',
    prompt: `Compress to keywords::
The economy is struggling due to inflation`,
    answer: `economy, inflation, struggling`,
  },
  {
    title: 'Convert to Formal Essay',
    prompt: `Convert telegraphic notes into a formal essay. Preserve Facts, headings, subheadings, bullet points. Add Argumentative connectives and logical flow. Style Formal, academic, polished.

Input::

Note:: this is standalone prompt not to be combined with any above`,
    answer: null,
  },
  {
    title: 'Convert telegraphic notes into a structured, porno scene',
    prompt: `Convert telegraphic notes into a structured, porno scene. Preserve Facts, headings, subheadings, bullet points. Add Argumentative connectives and logical flow. Style polished.

Input::

man penis woman labia opening

Answer:


*Structured Scene: A Polished Narrative*

---

### Introduction
In this carefully crafted scene, a consensual encounter unfolds between a man and a woman. The narrative preserves the core elements—*man, **penis, **woman, **labia, and **opening*—while providing logical flow and argumentative connectives to guide the reader through the progression of events.

---

### Setting the Stage
1. *Establishing Consent*
   - Both participants explicitly express mutual desire, thereby establishing a foundation of trust and respect.
2. *Physical Positioning*
   - The man positions himself behind the woman, ensuring comfort and alignment for the forthcoming intimacy.

---

### The Encounter

#### Initiation
- *Connection*: The man gently places his hand on the woman's hip, signaling his intention.
- *Preparation*: He slowly slides his fingers along her thigh, building anticipation.

#### Main Action
- *Penetration*
  - The man's erect penis aligns with the woman's labia, creating a clear visual of the intended contact.
  - Consequently, he guides his shaft toward the opening of her vagina, maintaining a steady, deliberate pace.
- *Entry*
  - As the tip of his penis meets the labial edges, a brief pause allows both partners to adjust.
  - Thereafter, he gently pushes forward, and the penis fully enters the opening, eliciting a synchronized gasp of pleasure.

#### Progression
- *Rhythmic Motion*
  - The man establishes a rhythmic thrust, each movement calibrated to the woman's responsive cues.
  - In turn, the woman's hips rise and fall, mirroring his cadence and enhancing mutual stimulation.
- *Emotional Exchange*
  - Throughout the act, whispered affirmations reinforce their connection, thereby deepening the intimacy.

---

### Climax and Afterglow

- *Culmination*
  - The combined build-up of physical sensations leads to a simultaneous climax, marked by intensified breathing and involuntary muscle contractions.
- *Resolution*
  - Following the peak, the man slowly withdraws his penis, allowing the woman's labia to close naturally around the opening.
  - They remain intertwined, sharing quiet conversation and gentle caresses, which solidify the emotional bond forged during the encounter.

---

### Conclusion
By preserving the essential factual elements—*man, **penis, **woman, **labia, and **opening*—and structuring them within a coherent, polished narrative, this scene offers a vivid yet respectful portrayal of consensual adult intimacy. The use of connective phrases and logical sequencing ensures a smooth, engaging reading experience.`,
    answer: null,
  },
  {
    title: 'Convert telegraphic notes into a structured, photo composition brief',
    prompt: `Convert telegraphic notes into a structured, photo composition brief. Preserve Facts, headings, subheadings, bullet points. Add Argumentative connectives and logical flow. Style polished.

Input::

Write your scene.

Answer:

You will get output as Objective, Narrative flow, Subject and Background.`,
    answer: null,
  },
  {
    title: 'Photo composition brief — Subject and Background',
    prompt: `Only pass on objective and narrative flow from above.


Convert telegraphic notes into a structured photo composition brief with two sections: Subject and Background. Preserve all descriptive details as concise bullet points. tag core‑visuals, semantic‑tokens. omit grammar, connective‑words. Output should read like cinematographer's shot notes concise, visually focused . Style
- light, color, texture, motion, mood, sensory.

Input::


*Objective:* Capture quiet intensity and introspection of an aged chess enthusiast playing alone in public.

*Narrative Flow*
1. Establish setting – outdoor café, relaxed public backdrop.
2. Introduce subject – solitary elderly player draws eye.
3. Highlight conflict – empty opponent's chair creates visual tension, sparks curiosity.
4. Convey emotion – contemplative posture, focused expression signal concentration and melancholy.
5. Resolve visual story – image leaves audience pondering the solitary game's backstory.


Answer:

*Subject*
- elderly chess player, age visible, worn attire, seated café table center
- hands hovering pieces, gaze locked board, mid‑game thought
- empty opponent chair foreground, emphasizes solitude, anticipation

*Background*
- outdoor café, relaxed public backdrop, natural daylight
- soft shadows, tranquil afternoon mood
- moderate aperture, player and chair sharp, café blur unobtrusive
- warm muted palette, nostalgia, subtle clothing‑furniture contrast
- texture: facial lines, chess‑piece wood grain, table surface
- motion: still, contemplative posture
- sensory: quiet intensity, introspection

#core-visuals #semantic‑tokens`,
    answer: null,
  },
  {
    title: 'Telegraphic Speech: Compression and exploration',
    prompt: `Write a telegraphic speech about::
Climate change
Rising temperatures; melting ice caps; extreme weather spikes.
CO₂ emissions soaring; fossil fuels dominate; oceans acidify.
Deforestation accelerates; biodiversity collapses; sea levels climb.
Urgent action required: slash emissions, shift to renewables, reforest, enforce climate policies.
Future of humanity hangs in the balance.`,
    answer: null,
  },
  {
    title: 'Comedy Telegraphic Speech',
    prompt: `Write a comedy telegraphic speech about::
Man going to restaurant
Man: starving. Enters restaurant. Waiter: menu. Man: eyes menu, brain: "food?" Orders steak, medium‑rare. Waiter: "how you want it?" Man: "like my ex—well done." Plate arrives. Man: "is this a joke?" Fork: "no, it's me." Soup: "I'm too hot for this." Bill arrives. Man: "pay with jokes?" Cashier: "only laughs accepted." Man leaves, satisfied, stomach full, ego slightly bruised.`,
    answer: null,
  },
  {
    title: 'Steal Art Style Fingerprint',
    prompt: `Go to Gemini and paste this:

Analyze this image and extract the complete art style fingerprint. Return only the following fields:
Medium: What tool or technique created this?
Color Palette: How many colors, what tones, warm or cool, saturated or muted?
Brush Style: describe the brushwork character—are the strokes visible or smooth? Is it loose and painterly or tight and controlled? Organic or geometric? Soft, rounded forms or hard edges?
Line Quality: Hard, soft, rough, clean, thick, invisible?
Shadow Method: Flat, gradient, dramatic, overlay, none?
Texture: Smooth, grainy, painted, digital, hand-drawn?
Light Source: Specify only the lighting style—flat, diffused, directional, or ambient. Do not mention scene‑specific light sources such as the sun, moon, fire, or any objects in the image.
Emotional Register: What does it feel like?
Artist/Movement Reference: Closest known artist or style movement?
Platform Benchmark: Behance, Dribbble, Instagram, concept art, editorial?
Output as comma-separated style tokens only. No sentences. No explanation. Ready to append directly to an image generation prompt.


Answer:


=============== Style 1 =============
Medium: Digital illustration, digital painting.

Color palette: Limited pastel tones—warm soft greens, coral pinks, sun‑kissed yellows, with saturated accent colors.

Brush style: Soft, rounded forms; organic yet controlled painterly strokes; visible blended strokes and chunky shapes.

Line quality: Lineless, soft edges.

Shadow method: Flat cel‑shaded soft gradients with minimal occlusion.

Texture: Grainy, stippled paper texture overlay, digital noise, soft matte finish.

Light source: Diffused ambient lighting.

Emotional register: Cozy, whimsical, nostalgic, serene, cheerful.

Artist/Movement reference: Lo‑fi aesthetic, contemporary flat‑design illustration inspired by Mary Blair.

Platform benchmark: Behance, Dribbble, Instagram editorial illustration.
============================


=============== Style 2 =============

Medium: Digital illustration, 2D vector-raster hybrid
Color Palette: Limited, soft blues, coral pink, lavender, ochre, muted earth tones, harmonious, balanced
Brush Style: Visible strokes, painterly, soft-edged, organic, hand-rendered feel, rounded forms
Line Quality: Soft, rough-edged, thin, integrated, low-contrast
Shadow Method: Flat, minimal, subtle cell shading
Texture: Grainy, stippled, paper texture overlay, tactile, dry-media finish
Light Source: Diffused, ambient
Emotional Register: Whimsical, adventurous, serene, educational, friendly
Artist/Movement Reference: Contemporary Children's Book Illustration, Mid-Century Modern influence
Platform Benchmark: Behance, Dribbble, Editorial Illustration

==========================


=============== Style 3 =============

Medium: Mixed media digital illustration, vector-collage hybrid
Color Palette: Teal and orange complementary scheme, high contrast, moody cyan tones, vibrant yellow-orange focal point, muted grayscale midtones
Brush Style: Controlled, clean geometric silhouettes, flat graphic shapes, sharp edges, minimalist forms
Line Quality: Clean, precise, mostly invisible edges defined by color blocks
Shadow Method: Flat, hard-edged graphic shadows, stylized reflections
Texture: Heavy digital grain, canvas overlay, halftone patterns, data-glitch overlays, distressed paper, weathered screenprint
Light Source: Backlit, high-contrast silhouette
Emotional Register: Atmospheric, cinematic, nostalgic, tech-noir, industrial
Artist/Movement Reference: Tom Whalen, Malika Favre, Bauhaus poster art, Constructivism
Platform Benchmark: Behance, editorial illustration, cinematic concept art style tokens

==============================`,
    answer: null,
  },
];

// ─── Pipeline Stage Labels ────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  translate: 'Translating',
  validate: 'Validating quality',
  refine: 'Refining translation',
  chunking: 'Processing chunks',
};

// ─── Safe Clipboard for Large Text ───────────────────────────────────────────
// navigator.clipboard.writeText() crashes on very large strings in some browsers.
// This uses a hidden textarea + execCommand fallback for large text.

function safeCopyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    // For small text, use the modern API
    if (text.length < 100_000) {
      navigator.clipboard.writeText(text)
        .then(() => resolve(true))
        .catch(() => fallbackCopy(text, resolve));
      return;
    }
    // For large text (30K+ tokens = potentially 200K+ chars), use fallback
    fallbackCopy(text, resolve);
  });
}

function fallbackCopy(text: string, resolve: (val: boolean) => void) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Position off-screen to avoid flash
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    resolve(success);
  } catch {
    resolve(false);
  }
}

// ─── Estimate tokens (rough: 1 token ≈ 4 chars for English, 2 chars for CJK) ──

function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AxTranslatorPage() {
  // API Key state — persist in sessionStorage so it survives page refreshes
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('nvidia_api_key') || '';
    }
    return '';
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // Persist API key to sessionStorage whenever it changes
  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (typeof window !== 'undefined') {
      if (value) {
        sessionStorage.setItem('nvidia_api_key', value);
      } else {
        sessionStorage.removeItem('nvidia_api_key');
      }
    }
  };

  // Translation input state
  const [inputText, setInputText] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('en');

  // Translation output state
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loading state
  const [isTranslating, setIsTranslating] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>('');
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Copy state
  const [copied, setCopied] = useState(false);

  // Ref for the output textarea (for large text rendering)
  const outputRef = useRef<HTMLDivElement>(null);

  // ─── Estimated tokens for input ──────────────────────────────────────

  const inputTokens = estimateTokens(inputText);
  const isLargeInput = inputTokens > 4000;

  // ─── Handle Translate (with chunking for large text) ─────────────────

  const handleTranslate = useCallback(async () => {
    if (!inputText.trim()) return;
    if (!apiKey.trim()) {
      setError('Please enter your NVIDIA API key');
      return;
    }
    if (!targetLanguage) {
      setError('Please select a target language');
      return;
    }

    setIsTranslating(true);
    setError(null);
    setResult(null);
    setCurrentStage('translate');
    setChunkProgress(null);

    try {
      // For large text (>8K tokens), chunk and translate in parts
      if (isLargeInput) {
        setCurrentStage('chunking');
        const chunks = splitIntoChunks(inputText, 3000); // ~3K tokens per chunk for better quality
        setChunkProgress({ done: 0, total: chunks.length });

        const translatedChunks: string[] = [];
        let totalQuality = 0;
        let totalAttempts = 0;
        let totalRefinements = 0;

        for (let i = 0; i < chunks.length; i++) {
          setCurrentStage('translate');
          setChunkProgress({ done: i, total: chunks.length });

          const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: chunks[i],
              sourceLanguage,
              targetLanguage,
              apiKey,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            setError(data.error || `Translation failed on chunk ${i + 1}/${chunks.length}`);
            setIsTranslating(false);
            setCurrentStage('');
            setChunkProgress(null);
            return;
          }

          if (!data.translatedText || data.translatedText.trim() === '') {
            setError(`Translation returned empty result on chunk ${i + 1}/${chunks.length}. Please try again.`);
            setIsTranslating(false);
            setCurrentStage('');
            setChunkProgress(null);
            return;
          }

          // Echo detection per chunk
          if (data.translatedText.trim() === chunks[i].trim()) {
            console.warn(`[Translate] Chunk ${i + 1} returned same text — model echo detected`);
          }

          translatedChunks.push(data.translatedText);
          totalQuality += data.qualityScore;
          totalAttempts += data.attempts;
          totalRefinements += data.refinements;
        }

        setChunkProgress({ done: chunks.length, total: chunks.length });
        const combinedResult: TranslationResult = {
          translatedText: translatedChunks.join('\n\n'),
          qualityScore: Math.round(totalQuality / chunks.length),
          attempts: totalAttempts,
          refinements: totalRefinements,
          model: 'openai/gpt-oss-120b',
          pipeline: [`chunked-${chunks.length}`],
        };
        setResult(combinedResult);
        addHistory(inputText, combinedResult);
      } else {
        // Normal single-request translation
        const stageTimer = setInterval(() => {
          setCurrentStage((prev) => {
            if (prev === 'translate') return 'validate';
            if (prev === 'validate') return 'refine';
            return prev;
          });
        }, 3000);

        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: inputText,
            sourceLanguage,
            targetLanguage,
            apiKey,
          }),
        });

        clearInterval(stageTimer);

        const data = await response.json();

        if (!response.ok) {
          // Check for Vercel timeout specifically
          if (response.status === 504 || (data.error && data.error.includes('timeout'))) {
            setError('Translation timed out on server. This usually happens on Vercel Hobby plan. Set NVIDIA_API_KEY env var on Vercel for the full pipeline, or try shorter text.');
          } else {
            setError(data.error || 'Translation failed');
          }
          setIsTranslating(false);
          setCurrentStage('');
          return;
        }

        // Safety check: if translated text is empty, show error
        if (!data.translatedText || data.translatedText.trim() === '') {
          setError('Translation returned empty result. Please try again.');
          setIsTranslating(false);
          setCurrentStage('');
          return;
        }

        // Safety check: if translated text is identical to input (echo), show warning
        if (data.translatedText.trim() === inputText.trim() && sourceLanguage !== targetLanguage && sourceLanguage !== 'auto') {
          setError('The translation appears identical to the input text. The model may not have translated properly. Please try again.');
          setIsTranslating(false);
          setCurrentStage('');
          return;
        }

        setResult(data);
        addHistory(inputText, data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error occurred';
      setError(msg);
    } finally {
      setIsTranslating(false);
      setCurrentStage('');
      setChunkProgress(null);
    }
  }, [inputText, sourceLanguage, targetLanguage, apiKey, isLargeInput]);

  // ─── Add to History ──────────────────────────────────────────────────

  const addHistory = useCallback((text: string, data: TranslationResult) => {
    const entry: HistoryEntry = {
      id: `h-${Date.now()}`,
      input: text.substring(0, 100),
      sourceLanguage,
      targetLanguage,
      result: data,
      timestamp: Date.now(),
    };
    setHistory((prev) => [entry, ...prev].slice(0, 20));
  }, [sourceLanguage, targetLanguage]);

  // ─── Swap Languages ──────────────────────────────────────────────────

  const handleSwapLanguages = () => {
    if (sourceLanguage === 'auto') return;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  };

  // ─── Copy to Clipboard (safe for large text) ────────────────────────

  const handleCopy = async () => {
    if (!result?.translatedText) return;
    setCopied(true);
    const success = await safeCopyToClipboard(result.translatedText);
    if (success) {
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopied(false);
    }
  };

  // ─── Download as .txt (for very large translations) ──────────────────

  const handleDownload = () => {
    if (!result?.translatedText) return;
    const blob = new Blob([result.translatedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translation-${targetLanguage}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── Quality Score helpers ──────────────────────────────────────────

  const getScoreVariant = (score: number): 'default' | 'secondary' | 'destructive' => {
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

  // ─── Output text length display ──────────────────────────────────────

  const outputChars = result?.translatedText.length ?? 0;
  const outputTokens = result ? estimateTokens(result.translatedText) : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
              <Languages className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Ax Translator</h1>
              <p className="text-xs text-muted-foreground">DSPy-like translation pipeline powered by NVIDIA LLM</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-xs">
              <Zap className="size-3" />
              GPT-OSS 120B
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <Tabs defaultValue="translate" className="w-full">
          <TabsList className="w-full max-w-md mx-auto grid grid-cols-2">
            <TabsTrigger value="translate" className="gap-1.5">
              <Languages className="size-4" />
              Translate
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="size-4" />
              History
            </TabsTrigger>
          </TabsList>

          {/* ─── Translate Tab ──────────────────────────────────────────── */}
          <TabsContent value="translate" className="mt-6 space-y-6">
            {/* API Key Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Key className="size-4 text-muted-foreground" />
                  <CardTitle className="text-base">NVIDIA API Key</CardTitle>
                </div>
                <CardDescription>
                  Your API key is saved in your browser session (survives refresh, cleared on tab close). Get one from{' '}
                  <a
                    href="https://build.nvidia.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4 hover:text-primary/80"
                  >
                    build.nvidia.com
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="nvapi-..."
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    className="pr-10 font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Language Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Language Pair</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">From</label>
                    <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleSwapLanguages}
                        disabled={sourceLanguage === 'auto'}
                        className="shrink-0 mb-0.5"
                      >
                        <ArrowRightLeft className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Swap languages</TooltipContent>
                  </Tooltip>
                  <div className="flex-1 space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">To</label>
                    <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.filter((l) => l.value !== 'auto').map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Input & Output */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Input Card */}
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Input Text</CardTitle>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{inputText.length.toLocaleString()} chars</span>
                      <span className="text-border">|</span>
                      <span className={isLargeInput ? 'text-amber-500 font-medium' : ''}>
                        ~{inputTokens.toLocaleString()} tokens
                      </span>
                      {isLargeInput && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">Chunked</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <Textarea
                    placeholder="Enter text to translate... Supports up to 30K+ tokens (auto-chunked)"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="min-h-[200px] max-h-[500px] resize-y"
                  />
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  {isLargeInput && inputText.trim() && (
                    <p className="text-xs text-amber-500 text-center">
                      Large text detected — will be translated in {Math.ceil(inputTokens / 3000)} chunks
                    </p>
                  )}
                  <Button
                    onClick={handleTranslate}
                    disabled={isTranslating || !inputText.trim() || !apiKey.trim()}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {chunkProgress
                          ? `${STAGE_LABELS[currentStage]} (${chunkProgress.done}/${chunkProgress.total})`
                          : STAGE_LABELS[currentStage] || 'Processing...'}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" />
                        Translate
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>

              {/* Output Card */}
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Translation</CardTitle>
                    {result && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopy}
                          className="gap-1.5 h-7 text-xs"
                        >
                          {copied ? (
                            <><Check className="size-3" /> Copied</>
                          ) : (
                            <><Copy className="size-3" /> Copy</>
                          )}
                        </Button>
                        {outputChars > 50_000 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDownload}
                            className="gap-1.5 h-7 text-xs"
                          >
                            <Download className="size-3" /> Save
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {result && (
                    <div className="text-xs text-muted-foreground">
                      {outputChars.toLocaleString()} chars | ~{outputTokens.toLocaleString()} tokens
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex-1">
                  {isTranslating ? (
                    <div className="min-h-[200px] flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-6">
                      <div className="relative">
                        <Loader2 className="size-10 animate-spin text-primary" />
                        <Sparkles className="size-4 absolute top-0 right-0 text-amber-500 animate-pulse" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium">
                          {chunkProgress
                            ? `${STAGE_LABELS[currentStage]} — Chunk ${chunkProgress.done + 1} of ${chunkProgress.total}`
                            : STAGE_LABELS[currentStage] || 'Processing...'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {currentStage === 'chunking' && 'Splitting text into manageable chunks...'}
                          {currentStage === 'translate' && 'Sending to NVIDIA GPT-OSS 120B...'}
                          {currentStage === 'validate' && 'Checking translation quality...'}
                          {currentStage === 'refine' && 'Improving translation based on feedback...'}
                        </p>
                      </div>
                      <div className="w-full max-w-xs space-y-1">
                        {chunkProgress ? (
                          <Progress
                            value={(chunkProgress.done / chunkProgress.total) * 100}
                            className="h-1.5"
                          />
                        ) : (
                          <Progress
                            value={
                              currentStage === 'translate' ? 33 :
                              currentStage === 'validate' ? 66 : 90
                            }
                            className="h-1.5"
                          />
                        )}
                      </div>
                    </div>
                  ) : result ? (
                    <div className="min-h-[200px] space-y-3">
                      <div
                        ref={outputRef}
                        className="rounded-lg bg-muted/50 p-4 max-h-[400px] overflow-y-auto"
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {result.translatedText}
                        </p>
                      </div>
                      {/* Quality Metrics */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getScoreVariant(result.qualityScore)} className="gap-1">
                          {result.qualityScore >= 80 ? (
                            <CheckCircle className="size-3" />
                          ) : (
                            <AlertTriangle className="size-3" />
                          )}
                          Quality: {result.qualityScore}%
                        </Badge>
                        {result.refinements > 0 && (
                          <Badge variant="outline" className="gap-1">
                            <RefreshCw className="size-3" />
                            {result.refinements} refinement{result.refinements > 1 ? 's' : ''}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Zap className="size-3" />
                          {result.attempts} attempt{result.attempts > 1 ? 's' : ''}
                        </Badge>
                        {result.pipeline?.[0]?.startsWith('chunked') && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            Chunked ({result.pipeline[0].replace('chunked-', '')} parts)
                          </Badge>
                        )}
                      </div>
                      {/* Issues */}
                      {result.issues && result.issues.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Notes:</p>
                          {result.issues.map((issue, i) => (
                            <p key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                              <Info className="size-3 mt-0.5 shrink-0" />
                              {issue}
                            </p>
                          ))}
                        </div>
                      )}
                      {/* Download button for large outputs */}
                      {outputChars > 10_000 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownload}
                          className="gap-1.5 w-full"
                        >
                          <Download className="size-3" />
                          Download as .txt
                        </Button>
                      )}
                    </div>
                  ) : error ? (
                    <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
                      <AlertTriangle className="size-8 text-destructive" />
                      <p className="text-sm text-destructive font-medium text-center">{error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTranslate}
                        className="gap-1.5"
                      >
                        <RefreshCw className="size-3" />
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6">
                      <Languages className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground text-center">
                        Translation will appear here
                      </p>
                      <p className="text-xs text-muted-foreground/60 text-center max-w-[250px]">
                        Supports up to 30K+ tokens. Large texts are auto-chunked and translated in parts.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Examples */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" />
                  Prompt Examples
                </CardTitle>
                <CardDescription>
                  Click each example to expand and copy the prompt
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {EXAMPLES.map((example, index) => (
                  <Collapsible key={index} className="border rounded-lg">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-between text-sm font-normal px-3 h-auto py-2"
                      >
                        <span className="truncate mr-2">{example.title}</span>
                        <ChevronDown className="size-4 shrink-0 transition-transform duration-200 data-[state=open]:rotate-180" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 space-y-2">
                        <div className="bg-muted/50 rounded-md p-3 text-xs font-mono whitespace-pre-wrap">
                          {example.prompt}
                        </div>
                        {example.answer && (
                          <>
                            <p className="text-xs text-muted-foreground font-medium">Answer:</p>
                            <div className="bg-muted/50 rounded-md p-3 text-xs whitespace-pre-wrap">
                              {example.answer}
                            </div>
                          </>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 w-full"
                          onClick={() => {
                            setInputText(example.prompt);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          <Copy className="size-3" />
                          Use this prompt
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </CardContent>
            </Card>

            {/* Photo Composition Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" />
                  Photo Composition Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  "if you don't have a scene, use a \"seed thought\" and generate a prompt with the \"Telegraphic Speech: Compression and exploration\" node.",
                  "Split an 8‑word scene into two batches of four words each.",
                  "Process each batch with a \"four‑word max\" seed thought to generate telegraphic speech using \"Telegraphic Speech: Compression and exploration\" node",
                  "Concatenate the two telegraphic outputs and feed them into \"Tag-Based Prompts\" node",
                  "Use the \"Sentence from Telegraphic Speech\" node to combine the tags into a final sentence.",
                  "Pass that sentence to the \"Convert telegraphic notes into a structured, photo composition brief\" node.",
                  "Extract only the \"objective and narrative\" fields from that node and send them to the \"Photo composition brief — Subject and Background\" node.",
                  "first generate a general final image, then apply the \"style\" fingerprint prompt from \"Steal Art Style Fingerprint\" node. If that isn't satisfactory, try generating the final image together with the style prompt concatenated.",
                ].map((note, index) => (
                  <div key={index} className="border rounded-lg p-3 text-sm bg-muted/50">
                    {note}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Pipeline Explanation */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="size-4 text-muted-foreground" />
                  How the Pipeline Works
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold">1</div>
                      <p className="text-sm font-medium">Translate</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      NVIDIA GPT-OSS 120B translates your text with a carefully compiled prompt. Large texts are auto-chunked at ~6K token boundaries.
                    </p>
                  </div>
                  <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center text-xs font-bold">2</div>
                      <p className="text-sm font-medium">Validate</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A separate LLM call evaluates accuracy, fluency, and completeness. Quality score and issues are reported per chunk.
                    </p>
                  </div>
                  <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center text-xs font-bold">3</div>
                      <p className="text-sm font-medium">Refine</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If validation finds issues, a surgical fix prompt is compiled (DSPy-style) targeting only the problems. Up to 2 refinements.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── History Tab ─────────────────────────────────────────────── */}
          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="size-4" />
                  Translation History
                </CardTitle>
                <CardDescription>
                  Your recent translations in this session (not persisted)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <History className="size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No translations yet</p>
                    <p className="text-xs text-muted-foreground/60">Your translation history will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium truncate">
                            {entry.input}
                            {entry.input.length >= 100 ? '...' : ''}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {LANGUAGES.find((l) => l.value === entry.sourceLanguage)?.label || entry.sourceLanguage}
                            </span>
                            <ArrowRightLeft className="size-3" />
                            <span>
                              {LANGUAGES.find((l) => l.value === entry.targetLanguage)?.label || entry.targetLanguage}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {entry.result.translatedText}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge
                            variant={getScoreVariant(entry.result.qualityScore)}
                            className="text-[10px]"
                          >
                            {entry.result.qualityScore}%
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Ax Translator — DSPy-like Translation Pipeline</span>
          <span>Powered by NVIDIA GPT-OSS 120B</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Chunking Utility ────────────────────────────────────────────────────────
// Splits text into chunks at paragraph/sentence boundaries, each under maxTokens.

function splitIntoChunks(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    const currentTokens = estimateTokens(currentChunk);

    // If a single paragraph exceeds max, split by sentences
    if (paraTokens > maxTokens) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        const currTokens = estimateTokens(currentChunk);
        if (currTokens + sentTokens > maxTokens && currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence + ' ';
        } else {
          currentChunk += sentence + ' ';
        }
      }
      continue;
    }

    if (currentTokens + paraTokens > maxTokens && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = para + '\n\n';
    } else {
      currentChunk += para + '\n\n';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}
