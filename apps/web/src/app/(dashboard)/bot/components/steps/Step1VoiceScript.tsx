'use client';

import { Volume2, User, Loader2, Square, Save, CheckCircle, ArrowRight } from 'lucide-react';
import { useState, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Deepgram Aura voices
const VOICES = [
  { id: 'aura-asteria-en', name: 'Asteria', gender: 'Female', accent: 'American' },
  { id: 'aura-luna-en', name: 'Luna', gender: 'Female', accent: 'American' },
  { id: 'aura-stella-en', name: 'Stella', gender: 'Female', accent: 'American' },
  { id: 'aura-athena-en', name: 'Athena', gender: 'Female', accent: 'British' },
  { id: 'aura-hera-en', name: 'Hera', gender: 'Female', accent: 'American' },
  { id: 'aura-orion-en', name: 'Orion', gender: 'Male', accent: 'American' },
  { id: 'aura-arcas-en', name: 'Arcas', gender: 'Male', accent: 'American' },
  { id: 'aura-perseus-en', name: 'Perseus', gender: 'Male', accent: 'American' },
  { id: 'aura-angus-en', name: 'Angus', gender: 'Male', accent: 'Irish' },
  { id: 'aura-orpheus-en', name: 'Orpheus', gender: 'Male', accent: 'American' },
  { id: 'aura-helios-en', name: 'Helios', gender: 'Male', accent: 'British' },
  { id: 'aura-zeus-en', name: 'Zeus', gender: 'Male', accent: 'American' },
];

const DEFAULT_SCRIPT = `Hello! This is a quick call from {company}.

We're reaching out about the final expense coverage you requested information on.

Is this a good time to speak for just a moment?`;

interface Step1VoiceScriptProps {
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  script: string;
  onScriptChange: (script: string) => void;
  hasPreviewedVoice: boolean;
  onPreviewVoice: () => Promise<void>;
  isScriptSaved: boolean;
  onSaveScript: () => Promise<void>;
  onContinue: () => void;
  apiUrl: string;
}

export function Step1VoiceScript({
  selectedVoice,
  onVoiceChange,
  script,
  onScriptChange,
  hasPreviewedVoice,
  onPreviewVoice,
  isScriptSaved,
  onSaveScript,
  onContinue,
}: Step1VoiceScriptProps) {
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePreview = async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsLoadingTTS(true);
    setIsPlaying(false);
    await onPreviewVoice();
    setIsLoadingTTS(false);
  };

  const handleStopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSaveScript();
    setSaveSuccess(true);
    setIsSaving(false);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const selectedVoiceData = VOICES.find(v => v.id === selectedVoice);
  const canContinue = selectedVoice && isScriptSaved;

  return (
    <div className="space-y-6">
      {/* Voice Selection - Card Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-primary" />
            Choose Your AI Voice
          </CardTitle>
          <CardDescription>Select the voice that best represents your brand</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {VOICES.map(voice => (
              <button
                key={voice.id}
                onClick={() => onVoiceChange(voice.id)}
                className={cn(
                  'flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left',
                  selectedVoice === voice.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-muted hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full shrink-0',
                    voice.gender === 'Female'
                      ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/50'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/50'
                  )}
                >
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{voice.name}</p>
                  <p className="text-xs text-muted-foreground">{voice.accent}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Preview Button */}
          {selectedVoiceData && (
            <div className="mt-6 flex items-center gap-4 p-4 rounded-lg bg-muted/50">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full shrink-0',
                  selectedVoiceData.gender === 'Female'
                    ? 'bg-pink-100 text-pink-600'
                    : 'bg-blue-100 text-blue-600'
                )}
              >
                <User className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{selectedVoiceData.name}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedVoiceData.gender} • {selectedVoiceData.accent}
                </p>
              </div>
              <Button
                onClick={isPlaying ? handleStopPlayback : () => void handlePreview()}
                disabled={isLoadingTTS || !script.trim()}
                variant={isPlaying ? 'destructive' : 'outline'}
                className="shrink-0"
              >
                {isLoadingTTS ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Square className="mr-2 h-4 w-4" />
                ) : (
                  <Volume2 className="mr-2 h-4 w-4" />
                )}
                {isLoadingTTS ? 'Generating...' : isPlaying ? 'Stop' : 'Preview Voice'}
              </Button>
              {hasPreviewedVoice && <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Script Editor */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Script</CardTitle>
          <CardDescription>
            Write what your AI caller will say. Use {'{name}'} and {'{company}'} for
            personalization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={script}
            onChange={e => onScriptChange(e.target.value)}
            placeholder="Enter your call script here..."
            className="min-h-[200px] font-mono text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {script.length} characters • ~{Math.ceil(script.split(' ').length / 150)} min read
            </p>
            <Button
              onClick={() => void handleSave()}
              disabled={isSaving}
              variant={saveSuccess ? 'default' : 'outline'}
              className={saveSuccess ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle className="mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Script'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Continue CTA */}
      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={!canContinue} size="lg" className="gap-2">
          Save & Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
