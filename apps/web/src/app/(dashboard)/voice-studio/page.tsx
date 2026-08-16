'use client';

import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
 * Clone voices, manage the library, and hear a voice perform a script before
 * it ever dials. Everything talks to /api/v1/fish/*, which proxies fish.audio
 * server-side — the Fish key is never in the browser.
 *
 * The voice id you land on here is what goes into the Dograh TTS config as
 * `voice` (Fish calls it reference_id). See deploy/dograh/fish-tts/.
 */

interface FishVoice {
  _id?: string;
  id?: string;
  title?: string;
  description?: string;
  state?: string;
  visibility?: string;
  languages?: string[];
  author?: { nickname?: string };
}

interface FishStatus {
  configured: boolean;
  defaultModel: string;
  models: string[];
  credit?: { credit?: string | number } | null;
}

const MODEL_LABELS: Record<string, string> = {
  's2.1-pro-free': 'S2.1 Pro Free — $0, no latency guarantee',
  's2.1-pro': 'S2.1 Pro — production, guaranteed TTFA',
  's2-pro': 'S2 Pro — previous generation',
  s1: 'S1 — legacy, (parenthesis) markers',
};

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

export default function VoiceStudioPage() {
  const [status, setStatus] = useState<FishStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [voices, setVoices] = useState<FishVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [searchOwn, setSearchOwn] = useState(true);
  const [searchTitle, setSearchTitle] = useState('');

  const [selectedVoice, setSelectedVoice] = useState<FishVoice | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Preview controls
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

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    setVoicesError(null);
    try {
      const params = new URLSearchParams({
        self: searchOwn ? 'true' : 'false',
        page_size: '24',
      });
      if (searchTitle.trim()) params.set('title', searchTitle.trim());

      const response = await fetch(`/api/v1/fish/voices?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        setVoicesError(await readError(response, 'Could not load voices.'));
        setVoices([]);
        return;
      }
      const body = await response.json();
      setVoices(Array.isArray(body?.items) ? body.items : []);
    } catch {
      setVoicesError('Could not reach Fish Audio.');
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }, [searchOwn, searchTitle]);

  useEffect(() => {
    if (status?.configured) void loadVoices();
  }, [status?.configured, loadVoices]);

  const deleteVoice = useCallback(
    async (voice: FishVoice) => {
      const id = voiceId(voice);
      if (!id) return;
      // Deleting a Fish model is irreversible and silently breaks every agent
      // still pointing at that reference_id, so make it a deliberate act.
      const confirmed = window.confirm(
        `Delete "${voice.title || id}" permanently?\n\n` +
          'Any Dograh agent still configured with this voice id will start failing on its next call.'
      );
      if (!confirmed) return;

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
        void loadVoices();
      } catch {
        setVoicesError('Could not reach Fish Audio.');
      }
    },
    [loadVoices, selectedVoice]
  );

  const renameVoice = useCallback(
    async (voice: FishVoice) => {
      const id = voiceId(voice);
      const title = window.prompt('New name for this voice', voice.title || '');
      if (!id || title === null || !title.trim()) return;

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
        void loadVoices();
      } catch {
        setVoicesError('Could not reach Fish Audio.');
      }
    },
    [loadVoices]
  );

  // --------------------------------------------------------------- preview

  const runPreview = useCallback(async () => {
    if (!script.trim()) return;
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
  }, [script, selectedVoice, model, latency, speed, volume, chunkLength, normalize]);

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
        setScript((prev) => `${prev}${snippet}`);
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

  return (
    <div className="space-y-6 p-6">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Studio</h1>
          <p className="text-sm text-muted-foreground">
            Clone a voice, hear it perform a script, then paste its id into the agent&apos;s TTS
            config.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {model === 's2.1-pro-free' && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
              Free tier — no latency guarantee
            </Badge>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ------------------------------------------------ script + preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Perform a script</CardTitle>
            <CardDescription>
              {selectedVoice ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Speaking as</span>
                  <span className="font-medium text-foreground">
                    {selectedVoice.title || voiceId(selectedVoice)}
                  </span>
                  <code className="rounded bg-muted px-1 text-xs">{voiceId(selectedVoice)}</code>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={copyVoiceId}>
                    {copiedId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span className="ml-1 text-xs">{copiedId ? 'Copied' : 'Copy id'}</span>
                  </Button>
                </span>
              ) : (
                'No voice selected — this will use the Fish default voice.'
              )}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Textarea
              ref={scriptRef}
              value={script}
              onChange={(event) => setScript(event.target.value)}
              rows={7}
              className="font-mono text-sm"
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
                <span>
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

              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(status.models || []).map((value) => (
                    <SelectItem key={value} value={value}>
                      {MODEL_LABELS[value] || value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {previewError && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {previewError}
              </p>
            )}

            {/* --------------------------------------- delivery controls */}
            <Tabs defaultValue="emotion" className="pt-2">
              <TabsList>
                <TabsTrigger value="emotion">Emotion &amp; tone</TabsTrigger>
                <TabsTrigger value="fine">Fine-grained</TabsTrigger>
                <TabsTrigger value="prosody">Prosody</TabsTrigger>
                <TabsTrigger value="agent">Use in agent</TabsTrigger>
              </TabsList>

              <TabsContent value="emotion" className="space-y-4 pt-4">
                <p className="text-xs text-muted-foreground">
                  Markers are inline text, not settings — the identical string works in a live call.
                  {markerFamily === 's1'
                    ? ' S1 uses (parentheses) and only the fixed tags below.'
                    : ' S2 uses [brackets] and accepts free-form descriptions like [slightly sad].'}
                </p>

                {EMOTION_GROUPS.map((group) => (
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

              <TabsContent value="fine" className="space-y-5 pt-4">
                <PhonemeBuilder onInsert={insertAtCaret} />

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

              <TabsContent value="prosody" className="space-y-5 pt-4">
                <div className="grid gap-5 sm:grid-cols-2">
                  <SliderField
                    label="Speed"
                    value={speed}
                    min={0.5}
                    max={2}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)}×`}
                    onChange={setSpeed}
                  />
                  <SliderField
                    label="Volume"
                    value={volume}
                    min={-20}
                    max={20}
                    step={1}
                    format={(v) => `${v > 0 ? '+' : ''}${v} dB`}
                    onChange={setVolume}
                  />
                  <SliderField
                    label="Chunk length"
                    value={chunkLength}
                    min={100}
                    max={300}
                    step={10}
                    format={(v) => `${v} tokens`}
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

              <TabsContent value="agent" className="space-y-3 pt-4">
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

        {/* ------------------------------------------------ library + clone */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Voices</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadVoices()}
                  disabled={loadingVoices}
                >
                  <RefreshCw className={`h-4 w-4 ${loadingVoices ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchTitle}
                    onChange={(event) => setSearchTitle(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void loadVoices()}
                    placeholder="Search by name"
                    className="pl-8"
                  />
                </div>
                <Button
                  variant={searchOwn ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearchOwn((prev) => !prev)}
                  title="Toggle between your own voices and Fish's public library"
                >
                  {searchOwn ? 'Mine' : 'Library'}
                </Button>
              </div>

              {voicesError && <p className="text-xs text-destructive">{voicesError}</p>}

              {loadingVoices ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : voices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {searchOwn ? 'No voices cloned yet.' : 'No matches in the public library.'}
                </p>
              ) : (
                <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                  {voices.map((voice) => {
                    const id = voiceId(voice);
                    const active = selectedVoice ? voiceId(selectedVoice) === id : false;
                    return (
                      <li key={id}>
                        <div
                          className={`rounded-md border p-2.5 transition-colors ${
                            active ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedVoice(voice)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {voice.title || id}
                              </span>
                              {voice.state && voice.state !== 'trained' && (
                                <Badge variant="outline" className="text-[10px]">
                                  {voice.state}
                                </Badge>
                              )}
                            </div>
                            <code className="block truncate text-[10px] text-muted-foreground">
                              {id}
                            </code>
                          </button>

                          {searchOwn && (
                            <div className="mt-2 flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs"
                                onClick={() => void renameVoice(voice)}
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-destructive"
                                onClick={() => void deleteVoice(voice)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <CloneVoiceCard onCloned={() => void loadVoices()} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

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
          Replaces one English word with CMU Arpabet. Stress digits: 1 primary, 2 secondary, 0
          none.{' '}
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
          onChange={(event) => setArpabet(event.target.value)}
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
        {ARPABET_PRESETS.map((preset) => (
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
    files.forEach((file) => form.append('voices', file, file.name));
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
          reverb, no overlapping voices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Name</Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Alex — outbound"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Description</Label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Samples</Label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <Upload className="h-4 w-4" />
            {files.length > 0 ? `${files.length} file(s) selected` : 'Choose .wav .mp3 .m4a .opus'}
            <input
              type="file"
              multiple
              accept=".wav,.mp3,.m4a,.opus,audio/*"
              className="hidden"
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Transcript (optional)</Label>
          <Textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
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
