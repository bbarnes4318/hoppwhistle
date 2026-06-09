'use client';

import { 
  CheckCircle2,
  ChevronLeft, 
  ChevronRight, 
  Copy,
  ExternalLink, 
  FileText,
  Heart, 
  MessageSquare, 
  Music,
  Pause, 
  Phone, 
  PhoneOff, 
  Play, 
  RotateCcw, 
  Share2, 
  Smartphone, 
  Sparkles, 
  Users,
  Mic,
  Video,
  Volume2,
  VolumeX
} from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// Ringtone generator using Web Audio API
const playRingtone = () => {
  if (typeof window === 'undefined') return () => {};
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return () => {};
    const ctx = new AudioContextClass();
    
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    
    const now = ctx.currentTime;
    // Ring cycle: 2s on, 2s off
    gainNode.gain.linearRampToValueAtTime(0.04, now + 0.1);
    gainNode.gain.setValueAtTime(0.04, now + 1.8);
    gainNode.gain.linearRampToValueAtTime(0, now + 2.0);
    
    gainNode.gain.linearRampToValueAtTime(0.04, now + 2.1);
    gainNode.gain.setValueAtTime(0.04, now + 3.8);
    gainNode.gain.linearRampToValueAtTime(0, now + 4.0);
    
    osc1.start(now);
    osc2.start(now);
    
    osc1.stop(now + 4.0);
    osc2.stop(now + 4.0);
    
    return () => {
      try {
        ctx.close();
      } catch (e) {}
    };
  } catch (e) {
    console.warn('Ringtone failed:', e);
    return () => {};
  }
};

// Interactive call controls helper
const CallControlsGrid = ({ isMuted, setIsMuted, isSpeakerOn, setIsSpeakerOn }: {
  isMuted: boolean;
  setIsMuted: (m: boolean) => void;
  isSpeakerOn: boolean;
  setIsSpeakerOn: (s: boolean) => void;
}) => {
  return (
    <div className="grid grid-cols-3 gap-y-2 gap-x-1.5 my-1 px-4 select-none shrink-0">
      {/* Mute Button */}
      <button 
        onClick={() => setIsMuted(!isMuted)} 
        className="flex flex-col items-center gap-0.5 group animate-fadeIn"
      >
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-200 border border-slate-800/40",
          isMuted ? "bg-white text-zinc-950 scale-105" : "bg-slate-900/60 text-zinc-100 hover:bg-slate-800/80"
        )}>
          <Mic className="h-3 w-3" />
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">{isMuted ? 'Muted' : 'Mute'}</span>
      </button>

      {/* Keypad (Disabled) */}
      <button className="flex flex-col items-center gap-0.5 opacity-30 cursor-not-allowed">
        <div className="h-7 w-7 rounded-full bg-slate-900/60 text-zinc-400 flex items-center justify-center border border-slate-800/40">
          <span className="text-[9px] font-bold font-mono">#</span>
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">Keypad</span>
      </button>

      {/* Speaker Button */}
      <button 
        onClick={() => setIsSpeakerOn(!isSpeakerOn)} 
        className="flex flex-col items-center gap-0.5 group animate-fadeIn"
      >
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-200 border border-slate-800/40",
          isSpeakerOn ? "bg-white text-zinc-950 scale-105" : "bg-slate-900/60 text-zinc-100 hover:bg-slate-800/80"
        )}>
          <Volume2 className="h-3 w-3" />
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">Speaker</span>
      </button>

      {/* Add Call (Disabled) */}
      <button className="flex flex-col items-center gap-0.5 opacity-30 cursor-not-allowed">
        <div className="h-7 w-7 rounded-full bg-slate-900/60 text-zinc-400 flex items-center justify-center border border-slate-800/40">
          <span className="text-[9px] font-bold">+</span>
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">Add Call</span>
      </button>

      {/* FaceTime (Disabled) */}
      <button className="flex flex-col items-center gap-0.5 opacity-30 cursor-not-allowed">
        <div className="h-7 w-7 rounded-full bg-slate-900/60 text-zinc-400 flex items-center justify-center border border-slate-800/40">
          <Video className="h-3 w-3" />
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">FaceTime</span>
      </button>

      {/* Contacts (Disabled) */}
      <button className="flex flex-col items-center gap-0.5 opacity-30 cursor-not-allowed">
        <div className="h-7 w-7 rounded-full bg-slate-900/60 text-zinc-400 flex items-center justify-center border border-slate-800/40">
          <Users className="h-3 w-3" />
        </div>
        <span className="text-[6.5px] text-zinc-400 font-medium">Contacts</span>
      </button>
    </div>
  );
};

// Define the stages
interface StageConfig {
  id: number;
  name: string;
  description: string;
  durationMs: number; // For autoplay mode
}

const STAGES: StageConfig[] = [
  { id: 1, name: 'Incoming Call', description: 'Simulated inbound artist line', durationMs: 4000 },
  { id: 2, name: 'Agent Introduction', description: 'RPS Voice Agent verified dialogue', durationMs: 6000 },
  { id: 3, name: 'Song Preview', description: 'In-call audio preview delivery', durationMs: 9000 },
  { id: 4, name: 'Feedback Capture', description: 'Interactive feedback logging', durationMs: 5000 },
  { id: 5, name: 'Branded SMS', description: 'Sponsor link delivery via text', durationMs: 5000 },
  { id: 6, name: 'Artist Portal', description: 'Opted-in landing page experience', durationMs: 5000 },
  { id: 7, name: 'Fan Club Registration', description: 'First-party lead capture form', durationMs: 6000 },
  { id: 8, name: 'Viral Sharing', description: 'Attributed referral loop', durationMs: 5000 },
  { id: 9, name: 'Proof Summary', description: 'Complete sponsor-ready packet', durationMs: 0 },
];

export function CustomerSideDemo() {
  const { toast } = useToast();
  const [stage, setStage] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [callTimer, setCallTimer] = useState<number>(0);
  const [previewProgress, setPreviewProgress] = useState<number>(0);
  const [feedbackSelected, setFeedbackSelected] = useState<'love' | 'ok' | 'skip' | null>(null);
  
  // Call Controls State
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState<boolean>(true);
  
  // Registration Form State
  const [name, setName] = useState<string>('Jimbo Barnes');
  const [city, setCity] = useState<string>('Dallas, TX');
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  
  // Social Share State
  const [sharesCount, setSharesCount] = useState<number>(0);
  const [likeClicked, setLikeClicked] = useState<boolean>(false);
  const [portalAudioPlaying, setPortalAudioPlaying] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const callTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Speak text helper using SpeechSynthesis API
  const speakText = (text: string) => {
    if (!audioFeedbackEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const naturalVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('natural')) ||
                            voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('google')) ||
                            voices.find(v => v.lang.startsWith('en'));
      if (naturalVoice) {
        utterance.voice = naturalVoice;
      }
      utterance.rate = 1.02; // SNappy speaking rate
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis failed:', e);
    }
  };

  // Ringtone simulation hook
  useEffect(() => {
    let cleanupRing: (() => void) | null = null;
    if (stage === 1 && audioFeedbackEnabled) {
      cleanupRing = playRingtone();
    }
    return () => {
      if (cleanupRing) cleanupRing();
    };
  }, [stage, audioFeedbackEnabled]);

  // Speech synthesis stage trigger hook
  useEffect(() => {
    if (stage === 2) {
      speakText("Hey, this is the Arrested Development station line. We're testing out 'Mr. Wendell' for their new release. Can I play you a short preview and you tell us if you like it?");
    } else if (stage === 4) {
      speakText("What did you think of Mr. Wendell? Keep it, skip it, or should we send you the link to the full track?");
    } else {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    }
  }, [stage, audioFeedbackEnabled]);

  // Sync audio with Stage 3 and Stage 6
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (stage === 3) {
      if (isPlaying || !timerRef.current) {
        audio.play().catch(err => console.log('Audio play blocked:', err));
      } else {
        audio.pause();
      }
    } else if (stage === 6 && portalAudioPlaying) {
      audio.play().catch(err => console.log('Audio play blocked:', err));
    } else {
      audio.pause();
      if (stage !== 6) {
        setPortalAudioPlaying(false);
      }
    }
  }, [stage, isPlaying, portalAudioPlaying]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Call timer effect for Stage 2, 3, 4
  useEffect(() => {
    if (stage >= 2 && stage <= 4) {
      if (!callTimerIntervalRef.current) {
        callTimerIntervalRef.current = setInterval(() => {
          setCallTimer(prev => prev + 1);
        }, 1000);
      }
    } else {
      if (callTimerIntervalRef.current) {
        clearInterval(callTimerIntervalRef.current);
        callTimerIntervalRef.current = null;
      }
      if (stage === 1) setCallTimer(0);
    }
    return () => {
      if (callTimerIntervalRef.current) clearInterval(callTimerIntervalRef.current);
    };
  }, [stage]);

  // Preview Progress Bar for Stage 3
  useEffect(() => {
    if (stage === 3) {
      setPreviewProgress(0);
      const step = 100 / (9000 / 100); // 9 seconds duration, 100ms steps
      previewIntervalRef.current = setInterval(() => {
        setPreviewProgress(prev => {
          if (prev >= 100) {
            clearInterval(previewIntervalRef.current!);
            return 100;
          }
          return prev + step;
        });
      }, 100);
    } else {
      if (previewIntervalRef.current) {
        clearInterval(previewIntervalRef.current);
        previewIntervalRef.current = null;
      }
    }
    return () => {
      if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
    };
  }, [stage]);

  // Autoplay progression loop
  useEffect(() => {
    if (isPlaying) {
      const currentStageConfig = STAGES.find(s => s.id === stage);
      if (currentStageConfig && currentStageConfig.durationMs > 0) {
        timerRef.current = setTimeout(() => {
          // Auto advance condition
          if (stage === 4 && !feedbackSelected) {
            setFeedbackSelected('love');
          }
          if (stage === 7 && !isRegistered) {
            setIsRegistered(true);
          }
          if (stage === 8 && sharesCount === 0) {
            setSharesCount(4);
          }
          setStage(prev => Math.min(prev + 1, 9));
        }, currentStageConfig.durationMs);
      } else {
        setIsPlaying(false);
      }
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, stage, feedbackSelected, isRegistered, sharesCount]);

  const handleStageChange = (newStage: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    
    // Reset specific states when jumping stages
    if (newStage < 4) {
      setFeedbackSelected(null);
    }
    if (newStage < 7) {
      setIsRegistered(false);
      setLikeClicked(false);
    }
    if (newStage < 8) {
      setSharesCount(0);
    }
    
    setStage(newStage);
  };

  const toggleAutoPlay = () => {
    setIsPlaying(!isPlaying);
    toast({
      title: !isPlaying ? 'Autoplay Activated' : 'Autoplay Paused',
      description: !isPlaying ? 'Demo will advance automatically through each stage.' : 'Autoplay paused. Step manually.',
    });
  };

  const handleReplay = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFeedbackSelected(null);
    setIsRegistered(false);
    setLikeClicked(false);
    setSharesCount(0);
    setCallTimer(0);
    setPreviewProgress(0);
    setStage(1);
    setIsPlaying(true);
    toast({
      title: 'Demo Restarted',
      description: 'Starting simulated fan journey from Stage 1.',
    });
  };

  const handleFeedback = (type: 'love' | 'ok' | 'skip') => {
    setFeedbackSelected(type);
    toast({
      title: 'Feedback Captured',
      description: `Fan feedback registered as: ${type === 'love' ? 'Love it!' : type === 'ok' ? 'Okay' : 'Not for me'}`,
    });
    // If not playing, auto advance shortly
    if (!isPlaying) {
      setTimeout(() => setStage(5), 1200);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistered(true);
    toast({
      title: 'Fan Club Registration Active',
      description: `Lead attributed for ${name} in ${city}`,
    });
    if (!isPlaying) {
      setTimeout(() => setStage(8), 1200);
    }
  };

  const handleLike = () => {
    setLikeClicked(true);
    toast({
      title: 'Song Pre-Saved',
      description: 'Fan liked the track. Added to their music platform library.',
    });
  };

  const handleShare = () => {
    setSharesCount(4);
    toast({
      title: 'Attributed Share Event',
      description: 'Mock share actions completed. 4 referral visits logged.',
    });
    if (!isPlaying) {
      setTimeout(() => setStage(9), 1500);
    }
  };

  const formatCallTime = (seconds: number) => {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  // Helper for status classes in the timeline
  const isTimelineItemActive = (itemStage: number) => {
    return stage >= itemStage;
  };

  const getSimulatedLogs = () => {
    const logs = [
      { time: '22:05:01', level: 'SYS', msg: 'System initialized. Waiting for inbound call signal.' },
    ];
    if (stage >= 1) {
      logs.push({ time: '22:05:03', level: 'SIP', msg: 'Inbound session request from +1 281-***-9460. Routing to voice agent node.' });
    }
    if (stage >= 2) {
      logs.push({ time: '22:05:07', level: 'AI', msg: 'Voice agent channel active. Executing verified introductory script.' });
      logs.push({ time: '22:05:09', level: 'STT', msg: 'Speech-to-text response recognized: "Sure, I\'ll listen."' });
    }
    if (stage >= 3) {
      logs.push({ time: '22:05:12', level: 'DSP', msg: 'Streaming 9-second high-fidelity preview of "Mr. Wendell".' });
      logs.push({ time: '22:05:18', level: 'SYS', msg: 'Audio packet stream transmission completed. Packet loss: 0%.' });
    }
    if (stage >= 4) {
      logs.push({ time: '22:05:21', level: 'AI', msg: 'Voice agent prompts for feedback signal. Awaiting user response.' });
      if (feedbackSelected) {
        logs.push({ time: '22:05:23', level: 'NLU', msg: `NLU classification: "${feedbackSelected}" sentiment recognized.` });
      }
    }
    if (stage >= 5) {
      logs.push({ time: '22:05:26', level: 'SMS', msg: 'Dispatching branded SMS text payload: rps.fm/arrested/mr-wendell.' });
      logs.push({ time: '22:05:28', level: 'SYS', msg: 'Carrier SMS delivery receipt verified.' });
    }
    if (stage >= 6) {
      logs.push({ time: '22:05:31', level: 'HTTP', msg: 'GET /arrested/mr-wendell from client IP. Direct attribution validated.' });
      if (likeClicked) {
        logs.push({ time: '22:05:33', level: 'DSP', msg: 'Spotify API pre-save request queued for Jimbo Barnes.' });
      }
    }
    if (stage >= 7) {
      logs.push({ time: '22:05:36', level: 'CRM', msg: 'Rendering fan club opt-in form. Session validated.' });
      if (isRegistered) {
        logs.push({ time: '22:05:39', level: 'CRM', msg: `First-party lead created. Lead name: "${name}", City: "${city}".` });
      }
    }
    if (stage >= 8) {
      logs.push({ time: '22:05:42', level: 'SYS', msg: 'Attributed viral sharing loop initialized. Attribution code: loop-34a' });
      if (sharesCount > 0) {
        logs.push({ time: '22:05:44', level: 'NET', msg: `Attributed share complete. 4 new nodes added to referral graph.` });
      }
    }
    if (stage >= 9) {
      logs.push({ time: '22:05:46', level: 'SYS', msg: 'Generating attribution packet rps-packet-ea712f009b.' });
      logs.push({ time: '22:05:48', level: 'SYS', msg: 'Sponsor verification signature attached. Campaign closed.' });
    }
    return logs.slice(-4);
  };

  return (
    <div className="flex flex-col h-full w-full space-y-3 overflow-hidden p-4 lg:p-6 text-[var(--m-text)]">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 text-[var(--m-text)] uppercase">
            <Smartphone className="h-5 w-5 text-[var(--m-accent)]" /> Customer-Side Fan Journey
          </h1>
          <p className="text-xs text-[var(--m-muted)] mt-1 max-w-2xl">
            See how an RPS voice interaction becomes a listen, feedback signal, branded link click, fan action, signup, share, and proof record.
          </p>
        </div>
        
        {/* Playback controls */}
        <div className="flex items-center gap-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] p-1.5 rounded-lg shrink-0">
          <button
            onClick={() => handleStageChange(Math.max(1, stage - 1))}
            disabled={stage === 1}
            className="p-1.5 rounded hover:bg-[var(--m-surface-3)] text-[var(--m-text-2)] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            title="Previous Stage"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          
          <button
            onClick={toggleAutoPlay}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded transition-all",
              isPlaying ? "bg-[var(--m-warning)] text-[var(--m-bg)]" : "bg-[var(--m-accent)] text-white"
            )}
          >
            {isPlaying ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
            {isPlaying ? 'Pause Auto' : 'Auto Play'}
          </button>

          <button
            onClick={() => {
              setAudioFeedbackEnabled(!audioFeedbackEnabled);
              toast({
                title: !audioFeedbackEnabled ? 'Audio Assist Enabled' : 'Audio Assist Disabled',
                description: !audioFeedbackEnabled 
                  ? 'Simulated voice agent speech and phone ringtones will play.' 
                  : 'Audio assist silenced.',
              });
            }}
            className={cn(
              "p-1.5 rounded hover:bg-[var(--m-surface-3)] transition-all",
              audioFeedbackEnabled ? "text-[var(--m-accent)] font-bold" : "text-[var(--m-muted)]"
            )}
            title={audioFeedbackEnabled ? "Mute Voice Assist" : "Enable Voice Assist"}
          >
            {audioFeedbackEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            onClick={handleReplay}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[var(--m-surface-3)] border border-[var(--m-border)] hover:border-[var(--m-text-2)] text-[var(--m-text)] rounded transition-all"
          >
            <RotateCcw className="h-3 w-3" />
            Replay
          </button>

          <button
            onClick={() => handleStageChange(Math.min(9, stage + 1))}
            disabled={stage === 9}
            className="p-1.5 rounded hover:bg-[var(--m-surface-3)] text-[var(--m-text-2)] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            title="Next Stage"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ─── Main 2-Column Grid ─── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-h-0 overflow-hidden pb-4">
        
        {/* Left Column: Phone Mockup Frame (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center min-h-0">
          {/* Phone Frame wrapper with metallic details */}
          <div className="relative w-64 h-[430px] bg-zinc-950 rounded-[28px] p-2 border-[4px] border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/10 flex flex-col overflow-hidden shrink-0">
            {/* Glossy reflection line */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none z-50 rounded-[24px]" />

            {/* Speaker & Sensor Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-4.5 bg-black rounded-b-lg z-50 flex items-center justify-center gap-1.5 px-3">
              <div className="w-10 h-0.5 bg-zinc-800 rounded-full" />
              <div className="w-1.5 h-1.5 bg-zinc-900 rounded-full" />
            </div>

            {/* Simulated Status Bar */}
            <div className={cn(
              "flex justify-between items-center px-5 pt-1.5 text-[9px] font-bold z-40 shrink-0 select-none",
              (stage >= 1 && stage <= 4) ? "bg-[#061A2F]/95 text-white" : "bg-white text-zinc-900"
            )}>
              <span>22:05</span>
              <div className="flex items-center gap-1">
                <span className="tracking-wide">5G</span>
                <div className="w-3.5 h-1.5 border rounded-xs p-[1px] flex items-center">
                  <div className="w-full h-full bg-current rounded-3xs" />
                </div>
              </div>
            </div>

            {/* Screen Content Area (Always White Background except Call Stages) */}
            <div className={cn(
              "flex-grow rounded-[24px] overflow-hidden flex flex-col relative transition-all duration-300 shadow-inner",
              (stage >= 1 && stage <= 4) ? "bg-gradient-to-b from-[#061A2F] via-[#020817] to-[#071B36]" : "bg-zinc-50"
            )}>
              
              {/* STAGE 1: Incoming Call */}
              {stage === 1 && (
                <div className="flex-grow flex flex-col justify-between p-3.5 text-white text-center animate-fadeIn select-none">
                  <div className="pt-4 space-y-0.5">
                    <span className="text-[8px] text-cyan-400 font-black tracking-[0.2em] uppercase block">Incoming Call</span>
                    <h2 className="text-sm font-bold tracking-tight">Arrested Dev Station</h2>
                    <p className="text-[8px] text-slate-400">RPS Media Line</p>
                  </div>

                  <div className="flex flex-col items-center gap-1.5 my-2">
                    <div className="h-11 w-11 rounded-full bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-center relative">
                      <Phone className="h-4 w-4 text-cyan-400 animate-pulse" />
                      <div className="absolute inset-0 rounded-full border border-cyan-400/40 animate-ping opacity-60" />
                    </div>
                    <span className="text-[7.5px] text-slate-400 animate-pulse">RPS Voice Agent dialling in...</span>
                  </div>

                  <div className="flex justify-around items-center pb-2 shrink-0">
                    <button
                      onClick={() => handleStageChange(1)}
                      className="flex flex-col items-center gap-0.5 group"
                    >
                      <div className="h-8.5 w-8.5 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg transition-all">
                        <PhoneOff className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-[7.5px] text-slate-400 font-medium group-hover:text-white transition-colors">Decline</span>
                    </button>
                    <button
                      onClick={() => handleStageChange(2)}
                      className="flex flex-col items-center gap-0.5 group"
                    >
                      <div className="h-8.5 w-8.5 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center shadow-lg transition-all animate-bounce">
                        <Phone className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-[7.5px] text-slate-400 font-medium group-hover:text-white transition-colors">Accept</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 2: Agent Intro */}
              {stage === 2 && (
                <div className="flex-grow flex flex-col justify-between p-2.5 text-white text-center animate-fadeIn">
                  {/* Call status header */}
                  <div className="pt-1 space-y-0.5 shrink-0">
                    <h2 className="text-xs font-bold text-zinc-100">Arrested Dev Station</h2>
                    <div className="flex items-center justify-center gap-1 text-[7.5px] text-emerald-400 font-mono">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{formatCallTime(callTimer)}</span>
                    </div>
                  </div>

                  {/* Call controls */}
                  <CallControlsGrid 
                    isMuted={isMuted} 
                    setIsMuted={setIsMuted} 
                    isSpeakerOn={isSpeakerOn} 
                    setIsSpeakerOn={setIsSpeakerOn} 
                  />

                  {/* Waveform graphic */}
                  <div className="my-1 h-6 flex items-end justify-center gap-[3px] px-3 shrink-0">
                    {Array.from({ length: 18 }).map((_, i) => {
                      const delays = [0.1, 0.4, 0.2, 0.6, 0.3, 0.5, 0.8, 0.2, 0.4, 0.7, 0.1, 0.5, 0.3, 0.9, 0.4, 0.2, 0.6, 0.1];
                      const heights = [8, 18, 12, 22, 14, 10, 20, 10, 16, 18, 8, 14, 12, 24, 12, 10, 16, 6];
                      const dur = 0.6 + delays[i % delays.length] * 0.5;
                      return (
                        <div 
                          key={i} 
                          className="w-0.5 bg-cyan-400 rounded-full m-wave-bar-anim"
                          style={{ 
                            height: `${heights[i % heights.length]}px`,
                            animationDelay: `${delays[i % delays.length]}s`,
                            animationDuration: `${dur}s`,
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Live Dialogue Transcript */}
                  <div className="flex-grow flex flex-col justify-end gap-1.5 text-left px-1 pb-1.5">
                    <div className="bg-slate-900/90 border border-slate-800/80 p-2 rounded-lg text-[9px] space-y-1 animate-fadeIn max-w-[92%]" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
                      <div className="text-[7px] font-black uppercase text-cyan-400 tracking-wider" style={{ color: '#22D3EE' }}>RPS Voice Agent</div>
                      <p className="text-zinc-200 leading-normal" style={{ color: '#E4E4E7' }}>
                        {"\"Hey, this is the Arrested Development station line. We\'re testing out \'Mr. Wendell\' for their new release. Can I play you a short preview and you tell us if you like it?\""}
                      </p>
                    </div>

                    <div className="bg-slate-800/70 border border-slate-700/50 p-2 rounded-lg text-[9px] space-y-1 animate-fadeIn max-w-[92%] self-end" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
                      <div className="text-[7px] font-black uppercase text-zinc-400 tracking-wider" style={{ color: '#A1A1AA' }}>Fan</div>
                      <p className="text-zinc-200 leading-normal" style={{ color: '#E4E4E7' }}>
                        {"\"Sure, I\'ll listen.\""}
                      </p>
                    </div>
                  </div>

                  {/* Action button */}
                  <button 
                    onClick={() => handleStageChange(3)}
                    className="w-full py-1.5 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-md flex items-center justify-center gap-1 text-white shadow-md transition-all shrink-0"
                  >
                    Start Preview <Play className="h-3 w-3 fill-current" />
                  </button>
                </div>
              )}

              {/* STAGE 3: Song Preview Plays */}
              {stage === 3 && (
                <div className="flex-grow flex flex-col justify-between p-2.5 text-white animate-fadeIn">
                  {/* Call header */}
                  <div className="text-center pt-1 space-y-0.5 shrink-0">
                    <h2 className="text-xs font-bold text-zinc-300">Arrested Dev Station</h2>
                    <span className="text-[8px] text-emerald-400 font-mono">{formatCallTime(callTimer)}</span>
                  </div>

                  {/* Call controls */}
                  <CallControlsGrid 
                    isMuted={isMuted} 
                    setIsMuted={setIsMuted} 
                    isSpeakerOn={isSpeakerOn} 
                    setIsSpeakerOn={setIsSpeakerOn} 
                  />

                  {/* Premium Music Player Card */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-col items-center gap-2 shadow-xl my-1.5">
                    <div className="h-12 w-12 rounded-lg bg-gradient-to-tr from-amber-500 via-emerald-800 to-amber-700 flex items-center justify-center relative overflow-hidden shadow-md group shrink-0">
                      <Music className="h-4.5 w-4.5 text-white animate-pulse" />
                      <div className="absolute inset-0 bg-black/20" />
                    </div>

                    <div className="text-center space-y-0.5">
                      <h3 className="text-[9px] font-bold text-white">Mr. Wendell</h3>
                      <p className="text-[8px] text-cyan-400 font-semibold">Arrested Development</p>
                    </div>

                    {/* Custom progress bar */}
                    <div className="w-full space-y-1">
                      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-cyan-400 rounded-full transition-all duration-100" 
                          style={{ width: `${previewProgress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[6px] text-zinc-500 font-mono">
                        <span>0:00</span>
                        <span className="animate-pulse text-cyan-400 font-bold">Preview playing...</span>
                        <span>0:09</span>
                      </div>
                    </div>

                    {/* Audio visualizer */}
                    <div className="h-4.5 flex items-end justify-center gap-[2px] w-full px-2 mt-0.5 shrink-0">
                      {Array.from({ length: 24 }).map((_, i) => {
                        const delays = [0.2, 0.5, 0.1, 0.7, 0.3, 0.6, 0.2, 0.8, 0.4, 0.1, 0.5, 0.9, 0.3, 0.6, 0.2, 0.7, 0.4, 0.8, 0.1, 0.5, 0.3, 0.6, 0.2, 0.4];
                        const heights = [6, 14, 10, 18, 12, 8, 16, 10, 14, 16, 6, 12, 10, 20, 8, 6, 14, 10, 4, 12, 8, 14, 6, 10];
                        const dur = 0.5 + delays[i % delays.length] * 0.7;
                        return (
                          <div 
                            key={i} 
                            className="w-0.5 bg-cyan-400 rounded-full m-wave-bar-anim"
                            style={{ 
                              height: `${heights[i % heights.length]}px`,
                              animationDelay: `${delays[i % delays.length]}s`,
                              animationDuration: `${dur}s`,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Advance Action */}
                  <button 
                    onClick={() => handleStageChange(4)}
                    className="w-full py-1.5 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-md flex items-center justify-center gap-1 text-white shadow-md transition-all shrink-0"
                  >
                    Provide Feedback
                  </button>
                </div>
              )}

              {/* STAGE 4: Feedback Capture */}
              {stage === 4 && (
                <div className="flex-grow flex flex-col justify-between p-2.5 text-white animate-fadeIn">
                  {/* Call header */}
                  <div className="text-center pt-1 space-y-0.5 shrink-0">
                    <h2 className="text-xs font-bold text-zinc-300">Arrested Dev Station</h2>
                    <span className="text-[8px] text-emerald-400 font-mono">{formatCallTime(callTimer)}</span>
                  </div>

                  {/* Call controls */}
                  <CallControlsGrid 
                    isMuted={isMuted} 
                    setIsMuted={setIsMuted} 
                    isSpeakerOn={isSpeakerOn} 
                    setIsSpeakerOn={setIsSpeakerOn} 
                  />

                  {/* Feedback UI Dialogue */}
                  <div className="space-y-1.5 my-1.5 flex-grow flex flex-col justify-center">
                    <div className="bg-slate-900/90 border border-slate-800/80 p-2 rounded-lg text-[9px] space-y-1 max-w-[92%]" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
                      <div className="text-[7px] font-black uppercase text-cyan-400 tracking-wider" style={{ color: '#22D3EE' }}>RPS Voice Agent</div>
                      <p className="text-zinc-200 leading-normal" style={{ color: '#E4E4E7' }}>
                        {"\"What did you think of Mr. Wendell? Keep it, skip it, or should we send you the link to the full track?\""}
                      </p>
                    </div>

                    <div className="space-y-1 pt-0.5 px-0.5">
                      <div className="text-[7px] font-bold uppercase text-slate-400 tracking-wider mb-1" style={{ color: '#94A3B8' }}>Simulated Feedback</div>
                      <button
                        onClick={() => handleFeedback('love')}
                        className={cn(
                          "w-full py-1 rounded-md text-[9px] font-bold flex items-center justify-between px-2 border transition-all",
                          feedbackSelected === 'love' 
                            ? "bg-emerald-600 border-emerald-500 text-white" 
                            : "bg-slate-900/60 border-slate-800 hover:border-emerald-500 text-zinc-300"
                        )}
                        style={{ color: feedbackSelected === 'love' ? '#FFFFFF' : '#D4D4D8' }}
                      >
                        <span>Love Mr. Wendell! Send link</span>
                        <span className="text-[7px] text-emerald-400 font-mono font-bold" style={{ color: '#10B981' }}>Positive</span>
                      </button>
                      <button
                        onClick={() => handleFeedback('ok')}
                        className={cn(
                          "w-full py-1 rounded-md text-[9px] font-bold flex items-center justify-between px-2 border transition-all",
                          feedbackSelected === 'ok' 
                            ? "bg-amber-600 border-amber-500 text-white" 
                            : "bg-slate-900/60 border-slate-800 hover:border-amber-500 text-zinc-300"
                        )}
                        style={{ color: feedbackSelected === 'ok' ? '#FFFFFF' : '#D4D4D8' }}
                      >
                        <span>{"It's okay"}</span>
                        <span className="text-[7px] text-amber-400 font-mono font-bold" style={{ color: '#FBBF24' }}>Neutral</span>
                      </button>
                      <button
                        onClick={() => handleFeedback('skip')}
                        className={cn(
                          "w-full py-1 rounded-md text-[9px] font-bold flex items-center justify-between px-2 border transition-all",
                          feedbackSelected === 'skip' 
                            ? "bg-red-600 border-red-500 text-white" 
                            : "bg-slate-900/60 border-slate-800 hover:border-red-500 text-zinc-300"
                        )}
                        style={{ color: feedbackSelected === 'skip' ? '#FFFFFF' : '#D4D4D8' }}
                      >
                        <span>Not for me, skip it</span>
                        <span className="text-[7px] text-red-400 font-mono font-bold" style={{ color: '#F87171' }}>Negative</span>
                      </button>
                    </div>
                  </div>

                  {/* Call ended button */}
                  <div className="flex justify-center shrink-0 mt-auto">
                    <button
                      onClick={() => handleStageChange(5)}
                      className="h-8 w-8 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg transition-all"
                      title="End Call"
                    >
                      <PhoneOff className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 5: Branded SMS */}
              {stage === 5 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-50 text-zinc-900 p-2.5 animate-fadeIn">
                  {/* SMS Header */}
                  <div className="flex items-center gap-2 border-b border-zinc-200 pb-1.5 mb-1.5 shrink-0">
                    <div className="h-6 w-6 rounded-full bg-zinc-300 flex items-center justify-center text-[9px] font-black text-zinc-700">A</div>
                    <div>
                      <h3 className="text-[9px] font-bold text-zinc-800">RPS: Arrested Dev</h3>
                      <p className="text-[7px] text-zinc-500">iMessage</p>
                    </div>
                  </div>

                  {/* Chat bubbles */}
                  <div className="flex-grow space-y-2 overflow-y-auto">
                    <div className="space-y-1 max-w-[88%]">
                      <div className="bg-zinc-200 rounded-xl p-2 text-[9px] text-zinc-800 leading-normal shadow-xs">
                        {"\"Thanks for listening to Arrested Development's 'Mr. Wendell'. Watch the official video here: rps.fm/arrested/mr-wendell\""}
                      </div>
                      
                      {/* Rich Link Card Mockup */}
                      <button
                        onClick={() => handleStageChange(6)}
                        className="w-full text-left bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-xs hover:border-[var(--m-accent)] hover:shadow-md transition-all group block"
                      >
                        <div className="h-16 w-full bg-gradient-to-r from-amber-500 via-indigo-900 to-emerald-500 relative flex items-center justify-center">
                          <Music className="h-5 w-5 text-white/55 animate-pulse" />
                        </div>
                        <div className="p-1.5 space-y-0.5">
                          <span className="text-[6px] text-zinc-400 font-mono block">RPS.FM</span>
                          <h4 className="text-[8px] font-bold text-zinc-800 group-hover:text-[var(--m-accent)] transition-colors leading-tight">Arrested Development - Mr. Wendell</h4>
                          <p className="text-[6px] text-zinc-500 line-clamp-1">Official Video & Spotify Pre-Save Portal</p>
                          <div className="flex justify-between items-center pt-1 border-t border-zinc-100 text-[7px] text-zinc-600 font-bold">
                            <span>Open in RPS Portal</span>
                            <ExternalLink className="h-1.5 w-1.5" />
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Mock keyboard input bar */}
                  <div className="border-t border-zinc-200 pt-1.5 shrink-0 flex items-center gap-1.5">
                    <div className="flex-grow bg-zinc-100 rounded-full px-2.5 py-1 text-[8px] text-zinc-400 border border-zinc-200">
                      iMessage
                    </div>
                    <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center cursor-pointer">
                      <span className="text-white text-[10px]">↑</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 6: Fan Opens Branded Music Page */}
              {stage === 6 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-950 text-white animate-fadeIn relative">
                  {/* Branded Web Header */}
                  <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 flex items-center justify-between shrink-0">
                    <span className="text-[7px] font-black tracking-widest text-zinc-400 uppercase">RPS Media Player</span>
                    <span className="text-[7px] text-emerald-400 font-semibold flex items-center gap-0.5">
                      <span className="h-0.5 w-0.5 bg-emerald-400 rounded-full animate-ping" /> Attribution Live
                    </span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-3 py-2 space-y-2.5">
                    {/* Hero Artwork with sliding vinyl disk */}
                    <div className="relative flex justify-center items-center py-1.5 shrink-0 overflow-hidden">
                      {/* Vinyl Disc */}
                      <div className={cn(
                        "absolute w-18 h-18 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center transition-all duration-[800ms] shadow-md z-0",
                        portalAudioPlaying ? "translate-x-9 rotate-[360deg] m-signal-disc-spin" : "translate-x-0"
                      )}>
                        {/* Vinyl grooves */}
                        <div className="absolute inset-1.5 rounded-full border border-white/5 bg-[radial-gradient(circle,_transparent_30%,_rgba(255,255,255,0.02)_40%,_transparent_50%)]" />
                        {/* Vinyl label */}
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 to-emerald-700 flex items-center justify-center border border-zinc-900">
                          <div className="w-1 h-1 rounded-full bg-zinc-950" />
                        </div>
                      </div>

                      {/* Album Cover */}
                      <div className="relative z-10 w-20 h-20 rounded-lg bg-gradient-to-tr from-amber-500 via-emerald-800 to-amber-700 flex flex-col justify-end p-2 overflow-hidden shadow-lg border border-white/10">
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                        <div className="relative z-20 space-y-0.5 text-left">
                          <span className="text-[6px] font-black text-cyan-400 uppercase tracking-wider block">Arrested Dev</span>
                          <h3 className="text-[9px] font-extrabold leading-tight text-white">Mr. Wendell</h3>
                          <p className="text-[6px] text-zinc-400 leading-none">RPS Records</p>
                        </div>
                      </div>
                    </div>

                    {/* Audio Player Controls */}
                    <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setPortalAudioPlaying(!portalAudioPlaying)}
                          className="h-6 w-6 rounded-full bg-[var(--m-accent)] flex items-center justify-center shadow-xs hover:bg-blue-600 transition-colors"
                        >
                          {portalAudioPlaying ? (
                            <Pause className="h-3 w-3 text-white fill-current" />
                          ) : (
                            <Play className="h-3 w-3 text-white fill-current" />
                          )}
                        </button>
                        <div>
                          <span className="text-[8px] font-bold text-zinc-200 block">
                            {portalAudioPlaying ? 'Now Playing...' : 'Listen to Track Preview'}
                          </span>
                          <span className="text-[6px] text-zinc-500 block">Streaming from RPS Nodes</span>
                        </div>
                      </div>
                      <span className="text-[8px] text-zinc-400 font-mono">4:06</span>
                    </div>

                    {/* Landing Page Action List */}
                    <div className="space-y-1.5">
                      <div className="text-[7px] font-black uppercase text-zinc-500 tracking-wider">Portal Actions</div>
                      
                      <button 
                        onClick={handleLike}
                        className={cn(
                          "w-full py-1.5 rounded-md text-[10px] font-bold flex items-center justify-between px-2 border transition-all",
                          likeClicked 
                            ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-400" 
                            : "bg-zinc-900 border-zinc-800 hover:border-[var(--m-accent)] text-zinc-100"
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <Heart className={cn("h-3 w-3", likeClicked ? "fill-current text-emerald-400" : "text-zinc-500")} /> 
                          {likeClicked ? 'Pre-Saved to Library' : 'Pre-Save Song'}
                        </span>
                        {!likeClicked && <span className="text-[7px] text-[var(--m-accent-2)] uppercase tracking-widest font-black font-mono">Save</span>}
                      </button>

                      <button 
                        onClick={() => handleStageChange(7)}
                        className="w-full py-1.5 bg-[var(--m-accent)] hover:bg-blue-600 text-white rounded-md text-[10px] font-bold flex items-center justify-between px-2 shadow-md transition-all border border-blue-500/30"
                      >
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3 w-3" /> Join Fan Club
                        </span>
                        <ChevronRight className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 7: Fan Club Registration */}
              {stage === 7 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-950 text-white animate-fadeIn relative">
                  {/* Web Header */}
                  <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 flex items-center justify-between shrink-0">
                    <span className="text-[7px] font-black tracking-widest text-zinc-400 uppercase">RPS Portal Gateway</span>
                    <span className="text-[7px] text-zinc-500 font-mono">Secure Form</span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-3 py-2.5 space-y-2.5">
                    {!isRegistered ? (
                      <form onSubmit={handleRegister} className="space-y-2 text-left">
                        <div className="space-y-0.5 text-center mb-1">
                          <h3 className="text-[10px] font-bold text-zinc-100">{"Join Arrested Dev's Fan Network"}</h3>
                          <p className="text-[7px] text-zinc-500">Opt-in to updates, tickets, and exclusive releases</p>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[7px] font-black text-zinc-400 uppercase tracking-wide">Full Name</label>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-white focus:outline-none focus:border-[var(--m-accent)]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[7px] font-black text-zinc-400 uppercase tracking-wide">Mobile Line</label>
                          <input
                            type="text"
                            value="+1 281-***-9460"
                            disabled
                            className="w-full px-2 py-1 bg-zinc-900/60 border border-zinc-800/80 rounded text-[10px] text-zinc-400 cursor-not-allowed"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[7px] font-black text-zinc-400 uppercase tracking-wide">Market (City)</label>
                          <input
                            type="text"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            required
                            className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-white focus:outline-none focus:border-[var(--m-accent)]"
                          />
                        </div>

                        <div className="pt-1.5">
                          <button
                            type="submit"
                            className="w-full py-1.5 bg-[var(--m-accent)] hover:bg-blue-600 rounded-md text-[10px] font-bold text-white shadow-md transition-all border border-blue-500/20"
                          >
                            Verify & Join Fan Club
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="text-center py-4 space-y-3 animate-fadeIn">
                        <div className="h-8 w-8 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-sm">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div className="space-y-0.5">
                          <h3 className="text-xs font-bold text-zinc-100">Welcome to the Fan Club!</h3>
                          <p className="text-[8px] text-zinc-400 px-2 leading-relaxed">
                            {"You're registered for Arrested Development. We'll send the full track link via text."}
                          </p>
                        </div>
                        <button
                          onClick={() => handleStageChange(8)}
                          className="px-4 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-[10px] rounded-md font-semibold transition-all"
                        >
                          Continue to Share
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STAGE 8: Viral Sharing */}
              {stage === 8 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-950 text-white animate-fadeIn relative">
                  {/* Web Header */}
                  <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 flex items-center justify-between shrink-0">
                    <span className="text-[7px] font-black tracking-widest text-zinc-400 uppercase">RPS Viral Loop</span>
                    <span className="text-[7px] text-zinc-500 font-mono">Attributed Referrals</span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-3 py-3 space-y-3">
                    <div className="text-center space-y-2">
                      <div className="h-8 w-8 bg-cyan-950/40 border border-cyan-500/20 rounded-full flex items-center justify-center mx-auto text-cyan-400">
                        <Share2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="space-y-0.5">
                        <h3 className="text-[10px] font-bold text-zinc-100">Attribute This Campaign</h3>
                        <p className="text-[8px] text-zinc-500">Share your listen with friends to activate referral rewards</p>
                      </div>
                    </div>

                    {/* Mock native sharing tray */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 space-y-2">
                      <div className="grid grid-cols-4 gap-1.5 text-center select-none">
                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-8 w-8 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                          </div>
                          <span className="text-[6px] text-zinc-400">Messages</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-8 w-8 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <span className="text-[10px] font-bold text-pink-400">IG</span>
                          </div>
                          <span className="text-[6px] text-zinc-400">Instagram</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-8 w-8 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <span className="text-[10px] font-bold text-white">𝕏</span>
                          </div>
                          <span className="text-[6px] text-zinc-400">Twitter</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-8 w-8 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <Copy className="h-3.5 w-3.5 text-emerald-400" />
                          </div>
                          <span className="text-[6px] text-zinc-400">Copy Link</span>
                        </button>
                      </div>

                      {sharesCount > 0 ? (
                        <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-md p-2 text-center text-[9px] text-emerald-400 font-semibold space-y-2 animate-fadeIn shrink-0">
                          <span>✓ Shared with 4 friends!</span>
                          <div className="flex justify-center items-center h-10 relative">
                            {/* Animated SVG Network Graph */}
                            <svg className="w-24 h-10" viewBox="0 0 100 40">
                              {/* Connector Lines */}
                              <line x1="50" y1="20" x2="15" y2="8" stroke="#10B981" strokeWidth="1" className="opacity-80 animate-pulse" />
                              <line x1="50" y1="20" x2="15" y2="32" stroke="#10B981" strokeWidth="1" className="opacity-80 animate-pulse" />
                              <line x1="50" y1="20" x2="85" y2="8" stroke="#10B981" strokeWidth="1" className="opacity-80 animate-pulse" />
                              <line x1="50" y1="20" x2="85" y2="32" stroke="#10B981" strokeWidth="1" className="opacity-80 animate-pulse" />
                              
                              {/* Center Node (You) */}
                              <circle cx="50" cy="20" r="4.5" fill="#145CFF" />
                              <text x="50" y="26" fontSize="5" fill="#FFF" textAnchor="middle" fontWeight="bold">You</text>
                              
                              {/* Friend Nodes */}
                              <circle cx="15" cy="8" r="3.5" fill="#10B981" />
                              <circle cx="15" cy="32" r="3.5" fill="#10B981" />
                              <circle cx="85" cy="8" r="3.5" fill="#10B981" />
                              <circle cx="85" cy="32" r="3.5" fill="#10B981" />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[7px] text-zinc-500 text-center animate-pulse py-1">
                          Click messaging icons above to share
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 shrink-0">
                    <button 
                      onClick={() => handleStageChange(9)}
                      className="w-full py-1.5 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-md flex items-center justify-center gap-1 text-white shadow-md transition-all border border-blue-500/20"
                    >
                      Complete Attribution Packet
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 9: Summary & Complete Proof */}
              {stage === 9 && (
                <div className="flex-grow flex flex-col bg-zinc-950 text-white animate-fadeIn">
                  <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 text-center shrink-0">
                    <h3 className="text-[8px] font-black uppercase text-cyan-400 tracking-widest">Attribution Receipt</h3>
                  </div>

                  <div className="flex-grow overflow-y-auto p-3 space-y-3">
                    {/* Status badge */}
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-md p-2 text-center space-y-0.5 shadow-sm">
                      <div className="flex items-center justify-center gap-1 text-emerald-400 font-bold text-[10px] uppercase tracking-wide">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Attribution Complete
                      </div>
                      <span className="text-[7px] text-zinc-500 font-mono block">Proof ID: rps-packet-ea712f009b</span>
                    </div>

                    {/* Receipt line items */}
                    <div className="space-y-1">
                      <div className="text-[7px] font-black text-zinc-500 uppercase tracking-wider">Interactions Recorded</div>
                      
                      <div className="space-y-1 text-[9px] bg-zinc-900/60 p-2 rounded-md border border-zinc-900">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Call answered:</span>
                          <span className="font-mono text-zinc-200">Yes (00:32)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Song preview delivered:</span>
                          <span className="font-mono text-zinc-200">1 (Mr. Wendell)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Feedback captured:</span>
                          <span className="font-mono text-zinc-200">{"\"Love it\" (Positive)"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Branded SMS delivered:</span>
                          <span className="font-mono text-zinc-200">Yes (rps.fm/arrested)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Song liked:</span>
                          <span className="font-mono text-zinc-200">Yes (Pre-saved)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Fan club signup:</span>
                          <span className="font-mono text-zinc-200">Yes (Jimbo Barnes)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Referral shares:</span>
                          <span className="font-mono text-zinc-200">4 attributed</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-zinc-800 text-[var(--m-accent-2)] font-bold">
                          <span>Est. Campaign Value:</span>
                          <span>$3.40</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 shrink-0">
                    <button
                      onClick={handleReplay}
                      className="w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white transition-all shadow-md"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Replay simulated loop
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
          {/* Right Column: Live Event Timeline & Business Context (7 cols) */}
        <div className="lg:col-span-7 flex flex-col h-full min-h-0 space-y-3 text-left">
          
          {/* Timeline Panel */}
          <div className="flex-1 min-h-0 overflow-y-auto m-card p-4 space-y-3 scrollbar-thin shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--m-border-2)] pb-2">
              <h2 className="text-xs font-black text-[var(--m-text)] uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Live Event Attribution Timeline
              </h2>
              <span className="text-[9px] font-mono text-[var(--m-muted)]">Stage {stage} of 9</span>
            </div>

            {/* Vertically stacked timeline events */}
            <div className="relative border-l border-[var(--m-border)] pl-4 space-y-3 py-1 ml-2">
              
              {/* Event 1 */}
              <div 
                onClick={() => handleStageChange(2)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(2) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(2) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(2) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">1. Human Answer Verified</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Call connected to opted-in mobile line. Audio channel validated.</p>
                </div>
              </div>

              {/* Event 2 */}
              <div 
                onClick={() => handleStageChange(3)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(3) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(3) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(3) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">2. Song Preview Delivered</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Audio Preview of {"\"Mr. Wendell\""} streamed to caller handset.</p>
                </div>
              </div>

              {/* Event 3 */}
              <div 
                onClick={() => handleStageChange(4)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(4) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(4) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(4) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">3. Fan Feedback Captured</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Voice feedback converted into positive sentiment score.</p>
                </div>
              </div>

              {/* Event 4 */}
              <div 
                onClick={() => handleStageChange(5)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(5) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(5) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(5) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">4. Branded Link Delivered</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Sponsor landing page url dispatched to client mobile via SMS payload.</p>
                </div>
              </div>

              {/* Event 5 */}
              <div 
                onClick={() => handleStageChange(6)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(6) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(6) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(6) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">5. Link Opened & Verified</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Link click registered on node server with UTM campaign codes.</p>
                </div>
              </div>

              {/* Event 6 */}
              <div 
                onClick={() => handleStageChange(7)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(7) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(7) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(7) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">6. Platform Save Attribute</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Fan liked and pre-saved the song. DSP API sync validated.</p>
                </div>
              </div>

              {/* Event 7 */}
              <div 
                onClick={() => handleStageChange(8)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(8) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(8) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(8) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">7. Fan Club Registration Completed</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Verified first-party contact lead logged inside the CRM data layer.</p>
                </div>
              </div>

              {/* Event 8 */}
              <div 
                onClick={() => handleStageChange(9)}
                className="relative cursor-pointer hover:bg-[var(--m-surface-3)]/50 transition-colors rounded-md p-1.5 -ml-1.5"
              >
                <div className={cn(
                  "absolute -left-[20px] top-2.5 h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(9) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-surface)] border-[var(--m-border)]"
                )}>
                  {isTimelineItemActive(9) && <span className="text-[7px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(9) ? "opacity-100" : "opacity-35 hover:opacity-75")}>
                  <h3 className="text-xs font-semibold text-[var(--m-text)] leading-none">8. Viral Share Attributed</h3>
                  <p className="text-[9px] text-[var(--m-muted)]">Mock share tracking loop recorded 4 referral actions and generated a proof packet.</p>
                </div>
              </div>

            </div>
          </div>

          {/* Telemetry Console */}
          <div className="shrink-0 bg-zinc-950 border border-zinc-900 rounded-xl p-3 font-mono text-[9px] text-zinc-300 space-y-1.5 shadow-inner">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1" style={{ borderBottomColor: 'rgba(255, 255, 255, 0.05)' }}>
              <span className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#22D3EE' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" style={{ backgroundColor: '#22D3EE' }} />
                Live Node Log / Telemetry Console
              </span>
              <span className="text-[7.5px] text-zinc-500 uppercase">Port 8080</span>
            </div>
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {getSimulatedLogs().map((log, index) => (
                <div key={index} className="flex gap-2 leading-relaxed">
                  <span className="text-zinc-500">{log.time}</span>
                  <span className={cn(
                    "font-bold shrink-0",
                    log.level === 'SYS' ? 'text-blue-400' :
                    log.level === 'SIP' ? 'text-purple-400' :
                    log.level === 'AI' ? 'text-cyan-400' :
                    log.level === 'STT' ? 'text-amber-400' :
                    log.level === 'DSP' ? 'text-emerald-400' :
                    log.level === 'SMS' ? 'text-pink-400' :
                    log.level === 'HTTP' ? 'text-sky-400' :
                    log.level === 'CRM' ? 'text-teal-400' : 'text-zinc-400'
                  )}
                    style={{
                      color: log.level === 'SYS' ? '#60A5FA' :
                             log.level === 'SIP' ? '#C084FC' :
                             log.level === 'AI' ? '#22D3EE' :
                             log.level === 'STT' ? '#FBBF24' :
                             log.level === 'DSP' ? '#34D399' :
                             log.level === 'SMS' ? '#F472B6' :
                             log.level === 'HTTP' ? '#38BDF8' :
                             log.level === 'CRM' ? '#2DD4BF' : '#A1A1AA'
                    }}
                  >[{log.level}]</span>
                  <span className="text-zinc-300" style={{ color: '#D4D4D8' }}>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Business Impact Card */}
          <div className="shrink-0 m-card p-4 bg-gradient-to-br from-[var(--m-surface)] to-[var(--m-surface-2)] border border-[var(--m-border)] space-y-2.5 shadow-sm">
            <h3 className="text-[10px] font-black uppercase text-[var(--m-accent)] tracking-widest flex items-center gap-1.5 font-mono">
              <Sparkles className="h-3.5 w-3.5 text-amber-500 fill-current" /> Why This Matters
            </h3>
            <p className="text-xs text-[var(--m-text-2)] leading-normal">
              RPS turns one fan phone interaction into a measurable media event: listen, feedback, click, like, signup, share, and proof. Every action becomes sponsor-ready attribution.
            </p>
            
            {/* Metric widgets */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
              <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded p-1.5 text-center">
                <span className="text-[8px] font-black uppercase text-[var(--m-muted)] tracking-wider block">Est. Action Value</span>
                <span className="text-xs font-bold m-font-mono text-[var(--m-text)] mt-0.5 block">$3.40</span>
              </div>
              <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded p-1.5 text-center">
                <span className="text-[8px] font-black uppercase text-[var(--m-muted)] tracking-wider block">Opt-In Rate</span>
                <span className="text-xs font-bold m-font-mono text-emerald-700 mt-0.5 block">100%</span>
              </div>
              <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded p-1.5 text-center">
                <span className="text-[8px] font-black uppercase text-[var(--m-muted)] tracking-wider block">Virality Coeff.</span>
                <span className="text-xs font-bold m-font-mono text-blue-700 mt-0.5 block">4.0x</span>
              </div>
              <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded p-1.5 text-center">
                <span className="text-[8px] font-black uppercase text-[var(--m-muted)] tracking-wider block">Attribution</span>
                <span className="text-[10px] font-bold text-emerald-700 mt-0.5 block uppercase font-mono leading-none">Complete</span>
              </div>
            </div>
          </div>

        </div>

      </div>
      <audio ref={audioRef} src="/mr-wendell.wav" preload="auto" />
    </div>
  );
}

