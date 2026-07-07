'use client';

import React, { useState, useCallback } from 'react';
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
  errorHistory?: Array<{
    attempt: number;
    stage: string;
    error: string;
  }>;
}

interface HistoryEntry {
  id: string;
  input: string;
  sourceLanguage: string;
  targetLanguage: string;
  result: TranslationResult;
  timestamp: number;
}

// ─── Pipeline Stage Labels ───────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  translate: 'Translating',
  validate: 'Validating quality',
  refine: 'Refining translation',
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AxTranslatorPage() {
  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

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

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Copy state
  const [copied, setCopied] = useState(false);

  // ─── Handle Translate ──────────────────────────────────────────────────

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

    // Simulate stage progression for UI feedback
    const stageTimer = setInterval(() => {
      setCurrentStage((prev) => {
        if (prev === 'translate') return 'validate';
        if (prev === 'validate') return 'refine';
        return prev;
      });
    }, 3000);

    try {
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
        setError(data.error || 'Translation failed');
        return;
      }

      setResult(data);

      // Add to history
      const entry: HistoryEntry = {
        id: `h-${Date.now()}`,
        input: inputText.substring(0, 100),
        sourceLanguage,
        targetLanguage,
        result: data,
        timestamp: Date.now(),
      };
      setHistory((prev) => [entry, ...prev].slice(0, 20));
    } catch (err: any) {
      clearInterval(stageTimer);
      setError(err?.message || 'Network error occurred');
    } finally {
      setIsTranslating(false);
      setCurrentStage('');
    }
  }, [inputText, sourceLanguage, targetLanguage, apiKey]);

  // ─── Swap Languages ────────────────────────────────────────────────────

  const handleSwapLanguages = () => {
    if (sourceLanguage === 'auto') return;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  };

  // ─── Copy to Clipboard ────────────────────────────────────────────────

  const handleCopy = async () => {
    if (!result?.translatedText) return;
    await navigator.clipboard.writeText(result.translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Quality Score Color ──────────────────────────────────────────────

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-amber-500';
    return 'text-red-500';
  };

  const getScoreVariant = (score: number): 'default' | 'secondary' | 'destructive' => {
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

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
              NVIDIA GPT-OSS
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
                  Your API key is used only for this session and never stored on our servers. Get one from{' '}
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
                    onChange={(e) => setApiKey(e.target.value)}
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
                    <span className="text-xs text-muted-foreground">
                      {inputText.length} chars
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <Textarea
                    placeholder="Enter text to translate... (e.g., jargon-heavy paragraph, technical content, unclear writing)"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="min-h-[200px] resize-none"
                  />
                </CardContent>
                <CardFooter>
                  <Button
                    onClick={handleTranslate}
                    disabled={isTranslating || !inputText.trim() || !apiKey.trim()}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {STAGE_LABELS[currentStage] || 'Processing...'}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopy}
                        className="gap-1.5 h-7 text-xs"
                      >
                        {copied ? (
                          <>
                            <Check className="size-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            Copy
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  {isTranslating ? (
                    <div className="min-h-[200px] flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-6">
                      <div className="relative">
                        <Loader2 className="size-10 animate-spin text-primary" />
                        <Sparkles className="size-4 absolute top-0 right-0 text-amber-500 animate-pulse" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium">{STAGE_LABELS[currentStage] || 'Processing...'}</p>
                        <p className="text-xs text-muted-foreground">
                          {currentStage === 'translate' && 'Sending to NVIDIA GPT-OSS 120B...'}
                          {currentStage === 'validate' && 'Checking translation quality...'}
                          {currentStage === 'refine' && 'Improving translation based on feedback...'}
                        </p>
                      </div>
                      <div className="w-full max-w-xs space-y-1">
                        <Progress
                          value={
                            currentStage === 'translate' ? 33 :
                            currentStage === 'validate' ? 66 : 90
                          }
                          className="h-1.5"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span className={currentStage === 'translate' ? 'text-primary font-medium' : ''}>Translate</span>
                          <span className={currentStage === 'validate' ? 'text-primary font-medium' : ''}>Validate</span>
                          <span className={currentStage === 'refine' ? 'text-primary font-medium' : ''}>Refine</span>
                        </div>
                      </div>
                    </div>
                  ) : result ? (
                    <div className="min-h-[200px] space-y-3">
                      <div className="rounded-lg bg-muted/50 p-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
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
                        Enter text, set your NVIDIA API key, and click Translate to start the DSPy-like pipeline
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

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
                      NVIDIA GPT-OSS 120B translates your text with a carefully compiled prompt that preserves meaning and tone.
                    </p>
                  </div>
                  <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center text-xs font-bold">2</div>
                      <p className="text-sm font-medium">Validate</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A separate LLM call evaluates accuracy, fluency, and completeness. Quality score and issues are reported.
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
