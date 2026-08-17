'use client';

import {
  AlertTriangle,
  Check,
  Copy,
  Globe2,
  Library,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AGENT_PROMPT_BLOCK,
  ARPABET_PRESETS,
  ARPABET_REFERENCE_URL,
  EMOTION_GROUPS,
  PARALANGUAGE_TAGS,
  markerFamilyFor,
  renderMarker,
  renderPhoneme,
  stripMarkers,
} from '@/lib/fish-markers';

/**
 * Fish Voice Studio.
 *
 * Clone voices, browse both your own library and Fish's public one, and hear a
 * voice perform a script before it ever dials. Everything talks to
 * /api/v1/fish/*, which proxies fish.audio server-side — the Fish key is never
 * in the browser.
 *
 * The voice id you land on here is what goes into the Dograh TTS config as
 * `voice` (Fish calls it reference_id). See deploy/dograh/fish-tts/.
 */

interface FishSample {
  audio?: string;
  title?: string;
}

interface FishVoice {
  _id?: string;
  id?: string;
  title?: string;
  description?: string;
  state?: string;
  visibility?: string;
  languages?: string[];
  author?: { nickname?: string };
  samples?: FishSample[];
  like_count?: number;
  task_count?: number;
}

interface FishStatus {
  configured: boolean;
  defaultModel: string;
  models: string[];
  credit?: { credit?: string | number } | null;
}

/** Which library the browser is showing. `library` maps to Fish's `self=false`. */
type VoiceSource = 'mine' | 'library';

const MODELS: Record<string, { label: string; note: string }> = {
  's2.1-pro-free': { label: 'S2.1 Pro Free', note: 'No cost · no latency guarantee' },
  's2.1-pro': { label: 'S2.1 Pro', note: 'Production · guaranteed TTFA' },
  's2-pro': { label: 'S2 Pro', note: 'Previous generation' },
  s1: { label: 'S1', note: 'Legacy · (parenthesis) markers' },
};

/**
 * Filter options for Fish's `language` query param. Fish keys voices by these
 * short codes; "any" simply omits the parameter.
 */
const LANGUAGES: { value: string; label: string }[] = [
  { value: 'any', label: 'Any language' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
];

const PAGE_SIZE = 24;

function voiceId(voice: FishVoice): string {
  return voice._id || voice.id || '';
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

/** First playable sample Fish returned for a voice, if any. */
function sampleUrl(voice: FishVoice): string | null {
  return voice.samples?.find(sample => sample.audio)?.audio || null;
}

export default function VoiceStudioPage() {
  const [status, setStatus] = useState<FishStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // ------------------------------------------------------------ library
  const [source, setSource] = useState<VoiceSource>('mine');
  const [voices, setVoices] = useState<FishVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [searchTitle, setSearchTitle] = useState('');
  const [language, setLanguage] = useState('any');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [selectedVoice, setSelectedVoice] = useState<FishVoice | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [renaming, setRenaming] = useState<FishVoice | null>(null);
  const [deleting, setDeleting] = useState<FishVoice | null>(null);

  // ------------------------------------------------------------ preview
  const [model, setModel] = useState('s2.1-pro-free');
  const [script, setScript] = useState(
    "[confident] Hi, this is Alex on a recorded line. [break] I'm calling about the hospital indemnity plan you asked about."
  );
  const [latency, setLatency] = useState('balanced');
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);
  const [chunkLength, setChunkLength] = useState(200);
  const [normalize, setNormalize] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // Sample playback is separate from the script preview so one never stops the
  // other mid-audition.
  const [samplePlayingId, setSamplePlayingId] = useState<string | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const scriptRef = useRef<HTMLTextAreaElement | null>(null);

  const markerFamily = markerFamilyFor(model);
  const spokenText = useMemo(() => stripMarkers(script), [script]);

  // ---------------------------------------------------------------- status

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/v1/fish/status', { headers: authHeaders() });
        if (cancelled) return;
        if (!response.ok) {
          setStatusError(await readError(response, 'Could not reach the Voice Studio API.'));
          return;
        }
        const body: FishStatus = await response.json();
        setStatus(body);
        if (body.defaultModel) setModel(body.defaultModel);
      } catch {
        if (!cancelled) setStatusError('Could not reach the Voice Studio API.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------- voices

  /**
   * Fetch one page. `append` keeps what's on screen and adds to it, which is
   * what "Load more" wants; a fresh search replaces instead.
   */
  const fetchVoices = useCallback(
    async (pageNumber: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoadingVoices(true);
      setVoicesError(null);

      try {
        const params = new URLSearchParams({
          self: source === 'mine' ? 'true' : 'false',
          page_size: String(PAGE_SIZE),
          page_number: String(pageNumber),
        });
        if (searchTitle.trim()) params.set('title', searchTitle.trim());
        if (language !== 'any') params.set('language', language);

        const response = await fetch(`/api/v1/fish/voices?${params.toString()}`, {
          headers: authHeaders(),
        });
        if (!response.ok) {
          setVoicesError(await readError(response, 'Could not load voices.'));
          if (!append) setVoices([]);
          return;
        }

        const body = await response.json();
        const items: FishVoice[] = Array.isArray(body?.items) ? body.items : [];
        setVoices(prev => (append ? [...prev, ...items] : items));
        setHasMore(items.length === PAGE_SIZE);
        setPage(pageNumber);
      } catch {
        setVoicesError('Could not reach Fish Audio.');
        if (!append) setVoices([]);
      } finally {
        setLoadingVoices(false);
        setLoadingMore(false);
      }
    },
    [source, searchTitle, language]
  );

  const reloadVoices = useCallback(() => void fetchVoices(1, false), [fetchVoices]);

  // Source and language changes restart paging; the title search is submitted
  // explicitly so typing doesn't hammer Fish.
  useEffect(() => {
    if (status?.configured) void fetchVoices(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.configured, source, language]);

  const stopSample = useCallback(() => {
    sampleAudioRef.current?.pause();
    sampleAudioRef.current = null;
    setSamplePlayingId(null);
  }, []);

  const toggleSample = useCallback(
    (voice: FishVoice) => {
      const url = sampleUrl(voice);
      const id = voiceId(voice);
      if (!url) return;

      if (samplePlayingId === id) {
        stopSample();
        return;
      }

      sampleAudioRef.current?.pause();
      const audio = new Audio(url);
      audio.onended = () => setSamplePlayingId(null);
      audio.onerror = () => setSamplePlayingId(null);
      sampleAudioRef.current = audio;
      void audio.play().then(
        () => setSamplePlayingId(id),
        () => setSamplePlayingId(null)
      );
    },
    [samplePlayingId, stopSample]
  );

  useEffect(() => () => sampleAudioRef.current?.pause(), []);

  const confirmDelete = useCallback(async () => {
    const voice = deleting;
    const id = voice ? voiceId(voice) : '';
    if (!voice || !id) return;

    try {
      const response = await fetch(`/api/v1/fish/voices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!response.ok) {
        setVoicesError(await readError(response, 'Could not delete the voice.'));
        return;
      }
      if (selectedVoice && voiceId(selectedVoice) === id) setSelectedVoice(null);
      reloadVoices();
    } catch {
      setVoicesError('Could not reach Fish Audio.');
    } finally {
      setDeleting(null);
    }
  }, [deleting, reloadVoices, selectedVoice]);

  const submitRename = useCallback(
    async (title: string) => {
      const voice = renaming;
      const id = voice ? voiceId(voice) : '';
      if (!voice || !id || !title.trim()) return;

      try {
        const response = await fetch(`/api/v1/fish/voices/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ title: title.trim() }),
        });
        if (!response.ok) {
          setVoicesError(await readError(response, 'Could not rename the voice.'));
          return;
        }
        setSelectedVoice(prev =>
          prev && voiceId(prev) === id ? { ...prev, title: title.trim() } : prev
        );
        reloadVoices();
      } catch {
        setVoicesError('Could not reach Fish Audio.');
      } finally {
        setRenaming(null);
      }
    },
    [renaming, reloadVoices]
  );

  // --------------------------------------------------------------- preview

  const runPreview = useCallback(async () => {
    if (!script.trim()) return;
    stopSample();
    setPreviewing(true);
    setPreviewError(null);
    setPreviewMs(null);

    const startedAt = performance.now();
    try {
      const response = await fetch('/api/v1/fish/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          text: script,
          voice: selectedVoice ? voiceId(selectedVoice) : undefined,
          model,
          latency,
          speed,
          volume,
          chunk_length: chunkLength,
          normalize,
        }),
      });

      if (!response.ok) {
        setPreviewError(await readError(response, 'Preview failed.'));
        return;
      }

      const blob = await response.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      setPreviewMs(Math.round(performance.now() - startedAt));

      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        void audio.play().catch(() => setPlaying(false));
      }
    } catch {
      setPreviewError('Could not reach Fish Audio.');
    } finally {
      setPreviewing(false);
    }
  }, [script, selectedVoice, model, latency, speed, volume, chunkLength, normalize, stopSample]);

  useEffect(
    () => () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  /** Insert marker text at the caret so it lands where you were typing. */
  const insertAtCaret = useCallback(
    (snippet: string) => {
      const textarea = scriptRef.current;
      if (!textarea) {
        setScript(prev => `${prev}${snippet}`);
        return;
      }
      const start = textarea.selectionStart ?? script.length;
      const end = textarea.selectionEnd ?? script.length;
      const next = `${script.slice(0, start)}${snippet}${script.slice(end)}`;
      setScript(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const caret = start + snippet.length;
        textarea.setSelectionRange(caret, caret);
      });
    },
    [script]
  );

  const copyVoiceId = useCallback(async () => {
    const id = selectedVoice ? voiceId(selectedVoice) : '';
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      /* clipboard unavailable — the id is on screen to copy by hand */
    }
  }, [selectedVoice]);

  // ----------------------------------------------------------------- views

  if (statusError) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{statusError}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <Card>
          <CardHeader>
            <CardTitle>Fish Audio is not configured</CardTitle>
            <CardDescription>
              Set <code className="rounded bg-muted px-1">FISH_API_KEY</code> on the API service and
              restart it. The key is read server-side only.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const credit = status.credit?.credit;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Voice Studio</h1>
            <p className="text-sm text-muted-foreground">
              Clone a voice, audition it on a real script, then paste its id into the agent&apos;s
              TTS config.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {credit !== undefined && credit !== null && (
            <Badge variant="outline" className="font-mono text-xs">
              Fish credit {typeof credit === 'number' ? `$${credit.toFixed(2)}` : credit}
            </Badge>
          )}
          {model === 's2.1-pro-free' && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
              Free tier — no latency guarantee
            </Badge>
          )}
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ---------------------------------------------- stage: script + preview */}
        <div className="min-w-0 space-y-5">
          <Card>
            {/* Selected voice — the single most important piece of state on the
                page, so it gets its own bar rather than a line of prose. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
              {selectedVoice ? (
                <>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
                    <UserRound className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {selectedVoice.title || voiceId(selectedVoice)}
                    </p>
                    <code className="block truncate font-mono text-[11px] text-muted-foreground">
                      {voiceId(selectedVoice)}
                    </code>
                  </div>
                  {(selectedVoice.languages || []).slice(0, 3).map(code => (
                    <Badge key={code} variant="secondary" className="text-[10px] uppercase">
                      {code}
                    </Badge>
                  ))}
                  <Button size="sm" variant="outline" className="h-8" onClick={copyVoiceId}>
                    {copiedId ? (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {copiedId ? 'Copied' : 'Copy id'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setSelectedVoice(null)}
                  >
                    Clear
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">No voice selected.</span> Previews
                  will use Fish&apos;s default voice — pick one from the library to audition it.
                </p>
              )}
            </div>

            <CardContent className="space-y-4 pt-5">
              <Textarea
                ref={scriptRef}
                value={script}
                onChange={event => setScript(event.target.value)}
                rows={7}
                className="resize-y font-mono text-sm leading-relaxed"
                placeholder="Type what the agent should say. Click markers below to shape delivery."
              />

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {spokenText.length} spoken characters
                  {script.length !== spokenText.length && (
                    <> · {script.length - spokenText.length} of markup</>
                  )}
                </span>
                {previewMs !== null && (
                  <span className="font-mono">
                    Round trip {previewMs} ms
                    {model === 's2.1-pro-free' && ' — free tier, expect this to vary'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={runPreview} disabled={previewing || !script.trim()}>
                  {previewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {previewing ? 'Generating…' : 'Hear it'}
                </Button>

                <Button
                  variant="outline"
                  disabled={!audioUrlRef.current}
                  onClick={() => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    if (playing) {
                      audio.pause();
                    } else {
                      audio.currentTime = 0;
                      void audio.play();
                    }
                  }}
                >
                  {playing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                  {playing ? 'Pause' : 'Replay'}
                </Button>

                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(status.models || []).map(value => (
                        <SelectItem key={value} value={value}>
                          <span className="font-medium">{MODELS[value]?.label || value}</span>
                          {MODELS[value] && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {MODELS[value].note}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {previewError && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {previewError}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ------------------------------------------- delivery controls */}
          <Card>
            <CardContent className="pt-5">
              <Tabs defaultValue="emotion">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="emotion">Emotion &amp; tone</TabsTrigger>
                  <TabsTrigger value="fine">Pronunciation</TabsTrigger>
                  <TabsTrigger value="prosody">Prosody</TabsTrigger>
                  <TabsTrigger value="agent">Use in agent</TabsTrigger>
                </TabsList>

                <TabsContent value="emotion" className="space-y-4 pt-5">
                  <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Markers are inline text, not settings — the identical string works in a live
                    call.
                    {markerFamily === 's1'
                      ? ' S1 uses (parentheses) and only the fixed tags below.'
                      : ' S2 uses [brackets] and accepts free-form descriptions like [slightly sad].'}
                  </p>

                  {EMOTION_GROUPS.map(group => (
                    <div key={group.label} className="space-y-2">
                      <div>
                        <p className="text-sm font-medium">{group.label}</p>
                        <p className="text-xs text-muted-foreground">{group.hint}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.tags.map(({ tag, note }) => (
                          <button
                            key={tag}
                            type="button"
                            title={note}
                            onClick={() => insertAtCaret(`${renderMarker(tag, markerFamily)} `)}
                            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs transition-colors hover:border-primary hover:bg-accent"
                          >
                            {renderMarker(tag, markerFamily)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="fine" className="space-y-5 pt-5">
                  <PhonemeBuilder onInsert={insertAtCaret} />

                  <Separator />

                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">Paralanguage</p>
                      <p className="text-xs text-muted-foreground">
                        These always use (parentheses), in both model families — unlike the emotion
                        cues. Fish marks the laugh/cough/sigh family experimental.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PARALANGUAGE_TAGS.map(({ tag, note }) => (
                        <button
                          key={tag}
                          type="button"
                          title={note}
                          onClick={() => insertAtCaret(`(${tag}) `)}
                          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs transition-colors hover:border-primary hover:bg-accent"
                        >
                          ({tag})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      Keep <span className="font-medium">Normalize</span> on. Phoneme tags survive
                      normalization, and switching it off makes Fish read prices, dates and phone
                      numbers unreliably — which is most of what the agent says.
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="prosody" className="space-y-5 pt-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SliderField
                      label="Speed"
                      value={speed}
                      min={0.5}
                      max={2}
                      step={0.05}
                      format={v => `${v.toFixed(2)}×`}
                      onChange={setSpeed}
                    />
                    <SliderField
                      label="Volume"
                      value={volume}
                      min={-20}
                      max={20}
                      step={1}
                      format={v => `${v > 0 ? '+' : ''}${v} dB`}
                      onChange={setVolume}
                    />
                    <SliderField
                      label="Chunk length"
                      value={chunkLength}
                      min={100}
                      max={300}
                      step={10}
                      format={v => `${v} tokens`}
                      hint="Smaller starts audio sooner; larger gives smoother prosody."
                      onChange={setChunkLength}
                    />
                    <div className="space-y-2">
                      <Label className="text-sm">Latency mode</Label>
                      <Select value={latency} onValueChange={setLatency}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="balanced">balanced — ~300ms, use for calls</SelectItem>
                          <SelectItem value="normal">normal — slower, most stable</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Reads backwards from the names: &quot;balanced&quot; is the faster one.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <Label className="text-sm">Normalize text</Label>
                      <p className="text-xs text-muted-foreground">
                        Expands numbers, dates and currency for natural reading.
                      </p>
                    </div>
                    <Switch checked={normalize} onCheckedChange={setNormalize} />
                  </div>
                </TabsContent>

                <TabsContent value="agent" className="space-y-3 pt-5">
                  <p className="text-sm text-muted-foreground">
                    Markers only reach Fish if the LLM writes them. Paste this into the agent&apos;s
                    globalNode prompt in AI Voice, and set the TTS provider to Fish Audio with the
                    voice id above.
                  </p>
                  <Textarea
                    readOnly
                    rows={12}
                    value={AGENT_PROMPT_BLOCK}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(AGENT_PROMPT_BLOCK)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy prompt block
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------ library + clone */}
        <div className="min-w-0">
          <Tabs defaultValue="voices">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="voices">
                <Library className="mr-2 h-3.5 w-3.5" />
                Voices
              </TabsTrigger>
              <TabsTrigger value="clone">
                <Wand2 className="mr-2 h-3.5 w-3.5" />
                Clone a voice
              </TabsTrigger>
            </TabsList>

            <TabsContent value="voices" className="pt-4">
              <Card>
                <CardHeader className="space-y-3 pb-3">
                  {/* Source is a real segmented control now — the public Fish
                      library is half of what this page is for. */}
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => setSource('mine')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        source === 'mine'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <UserRound className="h-3.5 w-3.5" />
                      My voices
                    </button>
                    <button
                      type="button"
                      onClick={() => setSource('library')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        source === 'library'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Globe2 className="h-3.5 w-3.5" />
                      Fish library
                    </button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {source === 'mine'
                      ? 'Voices you have cloned. Only these can be renamed or deleted.'
                      : "Fish Audio's public voice library — thousands of ready-made voices. Select one and use its id directly; nothing needs cloning."}
                  </p>

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={searchTitle}
                        onChange={event => setSearchTitle(event.target.value)}
                        onKeyDown={event => event.key === 'Enter' && reloadVoices()}
                        placeholder={
                          source === 'mine' ? 'Search your voices' : 'Search the Fish library'
                        }
                        className="pl-8"
                      />
                    </div>
                    <Button size="sm" variant="secondary" onClick={reloadVoices}>
                      Search
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={reloadVoices}
                      disabled={loadingVoices}
                      title="Refresh"
                    >
                      <RefreshCw className={`h-4 w-4 ${loadingVoices ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>

                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardHeader>

                <CardContent className="space-y-3">
                  {voicesError && (
                    <p className="flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {voicesError}
                    </p>
                  )}

                  {loadingVoices ? (
                    <div className="space-y-2 py-2">
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} className="h-[74px] animate-pulse rounded-md bg-muted/60" />
                      ))}
                    </div>
                  ) : voices.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="text-sm text-muted-foreground">
                        {source === 'mine'
                          ? 'No voices cloned yet.'
                          : 'No matches in the Fish library.'}
                      </p>
                      {source === 'mine' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Clone one, or switch to the Fish library above.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <ul className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                        {voices.map(voice => {
                          const id = voiceId(voice);
                          const active = selectedVoice ? voiceId(selectedVoice) === id : false;
                          const preview = sampleUrl(voice);
                          const isSamplePlaying = samplePlayingId === id;

                          return (
                            <li key={id}>
                              <div
                                className={`rounded-lg border p-3 transition-colors ${
                                  active
                                    ? 'border-primary bg-accent'
                                    : 'border-border hover:border-primary/40 hover:bg-accent/40'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedVoice(voice)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="truncate text-sm font-semibold">
                                        {voice.title || id}
                                      </span>
                                      {active && (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      )}
                                      {voice.state && voice.state !== 'trained' && (
                                        <Badge variant="outline" className="text-[10px]">
                                          {voice.state}
                                        </Badge>
                                      )}
                                    </div>

                                    {voice.description && (
                                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {voice.description}
                                      </p>
                                    )}

                                    <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                                      {id}
                                    </code>
                                  </button>

                                  {preview && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 w-8 shrink-0 p-0"
                                      title={isSamplePlaying ? 'Stop sample' : 'Play sample'}
                                      onClick={() => toggleSample(voice)}
                                    >
                                      {isSamplePlaying ? (
                                        <Pause className="h-3.5 w-3.5" />
                                      ) : (
                                        <Play className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  )}
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {(voice.languages || []).slice(0, 4).map(code => (
                                    <Badge
                                      key={code}
                                      variant="secondary"
                                      className="text-[10px] uppercase"
                                    >
                                      {code}
                                    </Badge>
                                  ))}
                                  {source === 'library' && voice.author?.nickname && (
                                    <span className="truncate text-[10px] text-muted-foreground">
                                      by {voice.author.nickname}
                                    </span>
                                  )}
                                  {source === 'mine' && voice.visibility && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {voice.visibility}
                                    </Badge>
                                  )}
                                </div>

                                {source === 'mine' && (
                                  <div className="mt-2 flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => setRenaming(voice)}
                                    >
                                      Rename
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs text-destructive"
                                      onClick={() => setDeleting(voice)}
                                    >
                                      <Trash2 className="mr-1 h-3 w-3" />
                                      Delete
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {hasMore && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled={loadingMore}
                          onClick={() => void fetchVoices(page + 1, true)}
                        >
                          {loadingMore ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {loadingMore ? 'Loading…' : 'Load more'}
                        </Button>
                      )}

                      <p className="text-center text-[11px] text-muted-foreground">
                        Showing {voices.length} voice{voices.length === 1 ? '' : 's'}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="clone" className="pt-4">
              <CloneVoiceCard
                onCloned={() => {
                  setSource('mine');
                  reloadVoices();
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <RenameDialog
        voice={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={title => void submitRename(title)}
      />
      <DeleteDialog
        voice={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

function RenameDialog({
  voice,
  onClose,
  onSubmit,
}: {
  voice: FishVoice | null;
  onClose: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (voice) setTitle(voice.title || '');
  }, [voice]);

  return (
    <Dialog open={!!voice} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename voice</DialogTitle>
          <DialogDescription>
            The id stays the same, so agents already using this voice keep working.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-sm">Name</Label>
          <Input
            value={title}
            autoFocus
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && title.trim() && onSubmit(title)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim()} onClick={() => onSubmit(title)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deleting a Fish model is irreversible and silently breaks every agent still
 * pointing at that reference_id, so the id is shown in full and the consequence
 * spelled out rather than hidden behind a generic confirm.
 */
function DeleteDialog({
  voice,
  onClose,
  onConfirm,
}: {
  voice: FishVoice | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!voice} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete &ldquo;{voice?.title || (voice ? voiceId(voice) : '')}&rdquo;?
          </DialogTitle>
          <DialogDescription>
            This cannot be undone. Any Dograh agent still configured with this voice id will start
            failing on its next call.
          </DialogDescription>
        </DialogHeader>
        {voice && (
          <code className="block truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
            {voiceId(voice)}
          </code>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Phoneme control. English replaces exactly one word per tag with CMU Arpabet,
 * so the builder is word-in / Arpabet-out rather than a free text box.
 */
function PhonemeBuilder({ onInsert }: { onInsert: (snippet: string) => void }) {
  const [arpabet, setArpabet] = useState('');

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Pronunciation (phoneme control)</p>
        <p className="text-xs text-muted-foreground">
          Replaces one English word with CMU Arpabet. Stress digits: 1 primary, 2 secondary, 0 none.{' '}
          <a
            href={ARPABET_REFERENCE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Arpabet reference
          </a>
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={arpabet}
          onChange={event => setArpabet(event.target.value)}
          placeholder="EH1 N JH AH0 N IH1 R"
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!arpabet.trim()}
          onClick={() => {
            onInsert(`${renderPhoneme(arpabet)} `);
            setArpabet('');
          }}
        >
          Insert
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ARPABET_PRESETS.map(preset => (
          <button
            key={preset.word}
            type="button"
            title={`${preset.arpabet}${preset.note ? ` — ${preset.note}` : ''}`}
            onClick={() => onInsert(`${renderPhoneme(preset.arpabet)} `)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:border-primary hover:bg-accent"
          >
            {preset.word}
          </button>
        ))}
      </div>
    </div>
  );
}

function CloneVoiceCard({ onCloned }: { onCloned: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [transcript, setTranscript] = useState('');
  const [enhance, setEnhance] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!title.trim() || files.length === 0) return;
    setSubmitting(true);
    setError(null);
    setCreated(null);

    const form = new FormData();
    form.set('title', title.trim());
    if (description.trim()) form.set('description', description.trim());
    // Visibility is deliberately not exposed: everything clones private. A
    // sales voice published to Fish's public library is not recoverable.
    form.set('visibility', 'private');
    form.set('enhance_audio_quality', enhance ? 'true' : 'false');
    files.forEach(file => form.append('voices', file, file.name));
    if (transcript.trim()) form.append('texts', transcript.trim());

    try {
      const response = await fetch('/api/v1/fish/voices', {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) {
        setError(await readError(response, 'Cloning failed.'));
        return;
      }
      const body = await response.json();
      setCreated(body?._id || body?.id || 'created');
      setTitle('');
      setDescription('');
      setTranscript('');
      setFiles([]);
      onCloned();
    } catch {
      setError('Could not reach Fish Audio.');
    } finally {
      setSubmitting(false);
    }
  }, [title, description, transcript, enhance, files, onCloned]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Clone a voice</CardTitle>
        <CardDescription className="text-xs">
          Clean, mono, single-speaker audio. 10s works; a minute or two is better. No music, no
          reverb, no overlapping voices. Everything clones private.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Name</Label>
          <Input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Alex — outbound"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Description</Label>
          <Input
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Samples</Label>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <Upload className="h-4 w-4" />
            <span>
              {files.length > 0
                ? `${files.length} file${files.length === 1 ? '' : 's'} selected`
                : 'Choose .wav .mp3 .m4a .opus'}
            </span>
            <input
              type="file"
              multiple
              accept=".wav,.mp3,.m4a,.opus,audio/*"
              className="hidden"
              onChange={event => setFiles(Array.from(event.target.files || []))}
            />
          </label>
          {files.length > 0 && (
            <ul className="space-y-0.5">
              {files.map(file => (
                <li key={file.name} className="truncate text-[11px] text-muted-foreground">
                  {file.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Transcript (optional)</Label>
          <Textarea
            value={transcript}
            onChange={event => setTranscript(event.target.value)}
            rows={2}
            placeholder="The exact words spoken in the sample — sharpens pronunciation."
            className="text-xs"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-2.5">
          <div>
            <Label className="text-sm">Enhance audio</Label>
            <p className="text-xs text-muted-foreground">
              Denoise and level. Turn off only for studio-grade audio.
            </p>
          </div>
          <Switch checked={enhance} onCheckedChange={setEnhance} />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {created && (
          <p className="text-xs text-emerald-600">
            Cloned. New voice id: <code className="font-mono">{created}</code>
          </p>
        )}

        <Button
          className="w-full"
          onClick={submit}
          disabled={submitting || !title.trim() || files.length === 0}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Cloning…' : 'Clone voice'}
        </Button>
      </CardContent>
    </Card>
  );
}
