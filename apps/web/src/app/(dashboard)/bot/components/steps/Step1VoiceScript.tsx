'use client';

/**
 * Project Cortex | Step 1: Voice & Script (Node Flow Interface)
 *
 * Persona cards for voice selection with glowing effects.
 * Dark inputs with neon focus states.
 */

import { Volume2, Loader2, Square, Save, CheckCircle, ArrowRight } from 'lucide-react';
import { useState, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { GlassPanel, NodeConnector } from '@/components/ui/glass-panel';
import { NodeTextarea } from '@/components/ui/node-input';
import { NodeLabel } from '@/components/ui/node-label';
import { PersonaCard, PersonaCardGrid } from '../PersonaCard';
import { cn } from '@/lib/utils';

// Deepgram Aura voices
const VOICES = [
  { id: 'aura-asteria-en', name: 'Asteria', gender: 'Female' as const, accent: 'American' },
  { id: 'aura-luna-en', name: 'Luna', gender: 'Female' as const, accent: 'American' },
  { id: 'aura-stella-en', name: 'Stella', gender: 'Female' as const, accent: 'American' },
  { id: 'aura-athena-en', name: 'Athena', gender: 'Female' as const, accent: 'British' },
  { id: 'aura-hera-en', name: 'Hera', gender: 'Female' as const, accent: 'American' },
  { id: 'aura-orion-en', name: 'Orion', gender: 'Male' as const, accent: 'American' },
  { id: 'aura-arcas-en', name: 'Arcas', gender: 'Male' as const, accent: 'American' },
  { id: 'aura-perseus-en', name: 'Perseus', gender: 'Male' as const, accent: 'American' },
  { id: 'aura-angus-en', name: 'Angus', gender: 'Male' as const, accent: 'Irish' },
  { id: 'aura-orpheus-en', name: 'Orpheus', gender: 'Male' as const, accent: 'American' },
  { id: 'aura-helios-en', name: 'Helios', gender: 'Male' as const, accent: 'British' },
  { id: 'aura-zeus-en', name: 'Zeus', gender: 'Male' as const, accent: 'American' },
];

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
    <div className="space-y-0">
      {/* NODE 01: Voice Selection */}
      <GlassPanel
        active
        accentColor="violet"
        title="NODE 01 // VOICE PERSONA"
        subtitle="Select the AI voice for your campaign"
        icon={<Volume2 className="h-5 w-5" />}
      >
        {/* Persona Cards Grid */}
        <PersonaCardGrid>
          {VOICES.map(voice => (
            <PersonaCard
              key={voice.id}
              voice={voice}
              selected={selectedVoice === voice.id}
              onSelect={() => onVoiceChange(voice.id)}
            />
          ))}
        </PersonaCardGrid>

        {/* Preview Section */}
        {selectedVoiceData && (
          <div className="mt-6 flex items-center gap-4 p-4 rounded-lg bg-void/50 border border-white/5">
            <div className="flex-1 min-w-0">
              <p className="font-display font-semibold text-neon-cyan uppercase tracking-wide">
                {selectedVoiceData.name}
              </p>
              <p className="text-xs text-text-muted font-mono">
                {selectedVoiceData.gender} • {selectedVoiceData.accent}
              </p>
            </div>
            <Button
              onClick={isPlaying ? handleStopPlayback : () => void handlePreview()}
              disabled={isLoadingTTS || !script.trim()}
              variant="outline"
              className={cn(
                'shrink-0 border-neon-cyan/30 text-neon-cyan',
                'hover:bg-neon-cyan/10 hover:border-neon-cyan'
              )}
            >
              {isLoadingTTS ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : isPlaying ? (
                <Square className="mr-2 h-4 w-4" />
              ) : (
                <Volume2 className="mr-2 h-4 w-4" />
              )}
              {isLoadingTTS ? 'GENERATING...' : isPlaying ? 'STOP' : 'PREVIEW'}
            </Button>
            {hasPreviewedVoice && <CheckCircle className="h-5 w-5 text-status-success shrink-0" />}
          </div>
        )}
      </GlassPanel>

      {/* Node Connector */}
      <NodeConnector />

      {/* NODE 02: Script Editor */}
      <GlassPanel
        active={!!selectedVoice}
        accentColor="cyan"
        title="NODE 02 // CONVERSATION SCRIPT"
        subtitle="Define what your AI will say. Use {name} and {company} for personalization."
      >
        <div className="space-y-4">
          <NodeLabel>SCRIPT CONTENT</NodeLabel>
          <NodeTextarea
            value={script}
            onChange={e => onScriptChange(e.target.value)}
            placeholder="Hello! This is a quick call from {company}..."
            className="min-h-[200px]"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted font-mono">
              {script.length} CHARS • ~{Math.ceil(script.split(' ').length / 150)} MIN READ
            </p>
            <Button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className={cn(
                'gap-2',
                saveSuccess
                  ? 'bg-status-success hover:bg-status-success/80'
                  : 'bg-neon-cyan text-void hover:bg-neon-cyan/80'
              )}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isSaving ? 'SAVING...' : saveSuccess ? 'SAVED' : 'SAVE SCRIPT'}
            </Button>
          </div>
        </div>
      </GlassPanel>

      {/* Continue CTA */}
      <div className="flex justify-end pt-6">
        <Button
          onClick={onContinue}
          disabled={!canContinue}
          size="lg"
          className={cn(
            'gap-2 font-display uppercase tracking-widest',
            'bg-neon-violet hover:bg-neon-violet/80 text-white',
            'shadow-[0_0_15px_rgba(156,74,255,0.3)]',
            'disabled:opacity-50 disabled:shadow-none'
          )}
        >
          CONTINUE TO ROUTING
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
