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
  Users
} from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

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
  
  // Registration Form State
  const [name, setName] = useState<string>('Jimbo Barnes');
  const [city, setCity] = useState<string>('Dallas, TX');
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  
  // Social Share State
  const [sharesCount, setSharesCount] = useState<number>(0);
  const [likeClicked, setLikeClicked] = useState<boolean>(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const callTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  return (
    <div className="space-y-6">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 m-text-text uppercase">
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Phone Mockup Frame (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          {/* Phone Frame wrapper */}
          <div className="relative w-80 h-[620px] bg-black rounded-[40px] p-3 border-4 border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] ring-1 ring-white/10 flex flex-col overflow-hidden">
            {/* Speaker & Sensor Notch */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-36 h-6 bg-black rounded-b-2xl z-50 flex items-center justify-center gap-1.5 px-4">
              <div className="w-12 h-1 bg-zinc-800 rounded-full" />
              <div className="w-2.5 h-2.5 bg-zinc-900 rounded-full" />
            </div>

            {/* Simulated Status Bar */}
            <div className={cn(
              "flex justify-between items-center px-6 pt-1 text-[10px] font-bold z-40 shrink-0 select-none",
              (stage >= 1 && stage <= 4) ? "bg-[#061A2F]/95 text-white" : "bg-white text-zinc-900"
            )}>
              <span>22:05</span>
              <div className="flex items-center gap-1">
                <span className="tracking-wide">5G</span>
                <div className="w-4 h-2 border rounded-xs p-[1px] flex items-center">
                  <div className="w-full h-full bg-current rounded-3xs" />
                </div>
              </div>
            </div>

            {/* Screen Content Area (Always White Background except Call Stages) */}
            <div className={cn(
              "flex-grow rounded-[30px] overflow-hidden flex flex-col relative transition-all duration-300 shadow-inner",
              (stage >= 1 && stage <= 4) ? "bg-gradient-to-b from-[#061A2F] via-[#020817] to-[#071B36]" : "bg-zinc-50"
            )}>
              
              {/* STAGE 1: Incoming Call */}
              {stage === 1 && (
                <div className="flex-grow flex flex-col justify-between p-6 text-white text-center animate-fadeIn select-none">
                  <div className="pt-12 space-y-1">
                    <span className="text-[10px] text-[var(--m-accent-2)] font-black tracking-[0.2em] uppercase block">Incoming Call</span>
                    <h2 className="text-xl font-bold tracking-tight">Nona Ray Station</h2>
                    <p className="text-[10px] text-slate-400">RPS Media Line</p>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="h-16 w-16 rounded-full bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/30 flex items-center justify-center relative">
                      <Phone className="h-6 w-6 text-[var(--m-accent-2)] animate-pulse" />
                      <div className="absolute inset-0 rounded-full border border-[var(--m-accent-2)]/40 animate-ping opacity-60" />
                    </div>
                    <span className="text-[9px] text-slate-400 animate-pulse">RPS Voice Agent is dialled in...</span>
                  </div>

                  <div className="flex justify-around items-center pb-6 shrink-0">
                    <button
                      onClick={() => handleStageChange(1)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg transition-all">
                        <PhoneOff className="h-5 w-5 text-white" />
                      </div>
                      <span className="text-[9px] text-slate-400 font-medium group-hover:text-white transition-colors">Decline</span>
                    </button>
                    <button
                      onClick={() => handleStageChange(2)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center shadow-lg transition-all animate-bounce">
                        <Phone className="h-5 w-5 text-white" />
                      </div>
                      <span className="text-[9px] text-slate-400 font-medium group-hover:text-white transition-colors">Accept</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 2: Agent Intro */}
              {stage === 2 && (
                <div className="flex-grow flex flex-col justify-between p-4 text-white text-center animate-fadeIn">
                  {/* Call status header */}
                  <div className="pt-4 space-y-0.5">
                    <h2 className="text-base font-bold text-zinc-100">Nona Ray Station</h2>
                    <div className="flex items-center justify-center gap-1 text-[9px] text-emerald-400 font-mono">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{formatCallTime(callTimer)}</span>
                    </div>
                  </div>

                  {/* Waveform graphic */}
                  <div className="my-2 h-16 flex items-center justify-center gap-1 px-4">
                    {Array.from({ length: 15 }).map((_, i) => (
                      <div 
                        key={i} 
                        className="w-1.5 bg-[var(--m-accent-2)] rounded-full transition-all duration-300"
                        style={{ 
                          height: `${Math.sin(callTimer * 2 + i) * 30 + 40}px`,
                          opacity: 0.4 + (Math.sin(callTimer + i) + 1) * 0.3
                        }}
                      />
                    ))}
                  </div>

                  {/* Live Dialogue Transcript */}
                  <div className="flex-grow flex flex-col justify-end gap-2 text-left px-1 pb-4">
                    <div className="bg-[var(--m-surface-3)] border border-[var(--m-border)] p-2.5 rounded-xl text-[10px] space-y-1.5 animate-fadeIn max-w-[90%]">
                      <div className="text-[8px] font-black uppercase text-[var(--m-accent-2)] tracking-wider">RPS Voice Agent</div>
                      <p className="text-zinc-200 leading-relaxed">
                        {"\"Hey, this is Nona Ray's station line. She's testing out a new single before release. Can I play you a short preview and you tell us if you like it?\""}
                      </p>
                    </div>

                    <div className="bg-zinc-800/80 border border-zinc-700/50 p-2.5 rounded-xl text-[10px] space-y-1.5 animate-fadeIn max-w-[90%] self-end">
                      <div className="text-[8px] font-black uppercase text-zinc-400 tracking-wider">Fan</div>
                      <p className="text-zinc-200 leading-relaxed">
                        {"\"Sure, I'll listen.\""}
                      </p>
                    </div>
                  </div>

                  {/* Accept/Decline action */}
                  <button 
                    onClick={() => handleStageChange(3)}
                    className="w-full py-2 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-lg flex items-center justify-center gap-1 text-white shadow-md transition-all shrink-0 mt-auto"
                  >
                    Start Preview <Play className="h-3 w-3 fill-current" />
                  </button>
                </div>
              )}

              {/* STAGE 3: Song Preview Plays */}
              {stage === 3 && (
                <div className="flex-grow flex flex-col justify-between p-4 text-white animate-fadeIn">
                  {/* Call header */}
                  <div className="text-center pt-2 space-y-0.5">
                    <h2 className="text-sm font-bold text-zinc-300">Nona Ray Station</h2>
                    <span className="text-[9px] text-emerald-400 font-mono">{formatCallTime(callTimer)}</span>
                  </div>

                  {/* Premium Music Player Card */}
                  <div className="my-auto bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-2xl p-4 flex flex-col items-center gap-4 shadow-xl">
                    <div className="h-32 w-32 rounded-xl bg-gradient-to-tr from-[#145CFF] via-[#0B2447] to-[#10B981] flex items-center justify-center relative overflow-hidden shadow-md group">
                      <Music className="h-10 w-10 text-white animate-pulse" />
                      <div className="absolute inset-0 bg-black/20" />
                    </div>

                    <div className="text-center space-y-0.5">
                      <h3 className="text-xs font-bold text-zinc-100">Midnight Signal</h3>
                      <p className="text-[9px] text-[var(--m-accent-2)] font-semibold">Nona Ray</p>
                    </div>

                    {/* Custom progress bar */}
                    <div className="w-full space-y-1.5 pt-2">
                      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-[var(--m-accent-2)] rounded-full transition-all duration-100" 
                          style={{ width: `${previewProgress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[8px] text-zinc-500 font-mono">
                        <span>0:00</span>
                        <span className="animate-pulse text-[var(--m-accent-2)] font-bold">Song preview playing...</span>
                        <span>0:09</span>
                      </div>
                    </div>
                  </div>

                  {/* Advance Action */}
                  <button 
                    onClick={() => handleStageChange(4)}
                    className="w-full py-2 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-lg flex items-center justify-center gap-1 text-white shadow-md transition-all shrink-0 mt-auto"
                  >
                    Provide Feedback
                  </button>
                </div>
              )}

              {/* STAGE 4: Feedback Capture */}
              {stage === 4 && (
                <div className="flex-grow flex flex-col justify-between p-4 text-white animate-fadeIn">
                  {/* Call header */}
                  <div className="text-center pt-2 space-y-0.5">
                    <h2 className="text-sm font-bold text-zinc-300">Nona Ray Station</h2>
                    <span className="text-[9px] text-emerald-400 font-mono">{formatCallTime(callTimer)}</span>
                  </div>

                  {/* Feedback UI Dialogue */}
                  <div className="my-auto space-y-4">
                    <div className="bg-[var(--m-surface-3)] border border-[var(--m-border)] p-3 rounded-xl text-[10px] space-y-1.5 max-w-[90%]">
                      <div className="text-[8px] font-black uppercase text-[var(--m-accent-2)] tracking-wider">RPS Voice Agent</div>
                      <p className="text-zinc-200 leading-relaxed">
                        {"\"What did you think of the new single? Keep it, skip it, or should we send you the link to the full track?\""}
                      </p>
                    </div>

                    <div className="space-y-2 pt-2 px-1">
                      <div className="text-[8px] font-black uppercase text-zinc-500 tracking-wider mb-1">Simulated Feedback Options</div>
                      <button
                        onClick={() => handleFeedback('love')}
                        className={cn(
                          "w-full py-2 rounded-lg text-xs font-bold flex items-center justify-between px-3 border transition-all",
                          feedbackSelected === 'love' 
                            ? "bg-emerald-600 border-emerald-500 text-white" 
                            : "bg-[var(--m-surface-2)] border-[var(--m-border)] hover:border-emerald-500 text-zinc-200"
                        )}
                      >
                        <span>Love it! Send full track link</span>
                        <span className="text-[10px] text-emerald-400 font-mono font-bold">Sentiment: Positive</span>
                      </button>
                      <button
                        onClick={() => handleFeedback('ok')}
                        className={cn(
                          "w-full py-2 rounded-lg text-xs font-bold flex items-center justify-between px-3 border transition-all",
                          feedbackSelected === 'ok' 
                            ? "bg-amber-600 border-amber-500 text-white" 
                            : "bg-[var(--m-surface-2)] border-[var(--m-border)] hover:border-amber-500 text-zinc-200"
                        )}
                      >
                        <span>{"It's okay"}</span>
                        <span className="text-[10px] text-amber-400 font-mono font-bold">Sentiment: Neutral</span>
                      </button>
                      <button
                        onClick={() => handleFeedback('skip')}
                        className={cn(
                          "w-full py-2 rounded-lg text-xs font-bold flex items-center justify-between px-3 border transition-all",
                          feedbackSelected === 'skip' 
                            ? "bg-red-600 border-red-500 text-white" 
                            : "bg-[var(--m-surface-2)] border-[var(--m-border)] hover:border-red-500 text-zinc-200"
                        )}
                      >
                        <span>Not for me, skip it</span>
                        <span className="text-[10px] text-red-400 font-mono font-bold">Sentiment: Negative</span>
                      </button>
                    </div>
                  </div>

                  {/* Call ended button */}
                  <div className="flex justify-center shrink-0 mt-auto">
                    <button
                      onClick={() => handleStageChange(5)}
                      className="h-10 w-10 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-lg transition-all"
                      title="End Call"
                    >
                      <PhoneOff className="h-4.5 w-4.5 text-white" />
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 5: Branded SMS */}
              {stage === 5 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-50 text-zinc-900 p-3 animate-fadeIn">
                  {/* SMS Header */}
                  <div className="flex items-center gap-2 border-b border-zinc-200 pb-2 mb-2 shrink-0">
                    <div className="h-7 w-7 rounded-full bg-zinc-300 flex items-center justify-center text-[10px] font-black text-zinc-700">R</div>
                    <div>
                      <h3 className="text-[10px] font-bold text-zinc-800">RPS: Nona Ray</h3>
                      <p className="text-[8px] text-zinc-500">iMessage</p>
                    </div>
                  </div>

                  {/* Chat bubbles */}
                  <div className="flex-grow space-y-3 overflow-y-auto">
                    <div className="space-y-1 max-w-[85%]">
                      <div className="bg-zinc-200 rounded-2xl p-2.5 text-[10px] text-zinc-800 leading-relaxed shadow-xs">
                        {"\"Thanks for listening to Nona Ray's new single. Watch the official video here: rps.fm/nona/midnight-signal\""}
                      </div>
                      
                      {/* Rich Link Card Mockup */}
                      <button
                        onClick={() => handleStageChange(6)}
                        className="w-full text-left bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-xs hover:border-[var(--m-accent)] hover:shadow-md transition-all group block"
                      >
                        <div className="h-24 w-full bg-gradient-to-r from-blue-600 via-indigo-900 to-emerald-500 relative flex items-center justify-center">
                          <Music className="h-6 w-6 text-white/55" />
                        </div>
                        <div className="p-2 space-y-0.5">
                          <span className="text-[7px] text-zinc-400 font-mono block">RPS.FM</span>
                          <h4 className="text-[9px] font-bold text-zinc-800 group-hover:text-[var(--m-accent)] transition-colors">Nona Ray - Midnight Signal</h4>
                          <p className="text-[7px] text-zinc-500 line-clamp-1">Official Video & Spotify Pre-Save Portal</p>
                          <div className="flex justify-between items-center pt-1 border-t border-zinc-100 text-[8px] text-zinc-600 font-bold">
                            <span>Open in RPS Portal</span>
                            <ExternalLink className="h-2 w-2" />
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Mock keyboard input bar */}
                  <div className="border-t border-zinc-200 pt-2 shrink-0 flex items-center gap-2">
                    <div className="flex-grow bg-zinc-100 rounded-full px-3 py-1.5 text-[9px] text-zinc-400 border border-zinc-200">
                      iMessage
                    </div>
                    <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center cursor-pointer">
                      <span className="text-white text-xs">↑</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 6: Fan Opens Branded Music Page */}
              {stage === 6 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-950 text-white animate-fadeIn relative">
                  {/* Branded Web Header */}
                  <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
                    <span className="text-[8px] font-black tracking-widest text-zinc-400 uppercase">RPS Media Player</span>
                    <span className="text-[8px] text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="h-1 w-1 bg-emerald-400 rounded-full animate-ping" /> Verified Attribution
                    </span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-4 py-3 space-y-4">
                    {/* Hero Artwork */}
                    <div className="w-full h-32 rounded-xl bg-gradient-to-tr from-[#145CFF] to-[#10B981] flex flex-col justify-end p-3 relative overflow-hidden shadow-lg border border-white/5">
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                      <div className="relative z-10 space-y-0.5">
                        <span className="text-[8px] font-black text-[var(--m-accent-2)] uppercase tracking-wider">New Release</span>
                        <h2 className="text-base font-bold leading-tight text-white">Midnight Signal</h2>
                        <p className="text-[9px] text-zinc-300">Nona Ray</p>
                      </div>
                    </div>

                    {/* Audio Player Controls */}
                    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2">
                        <button className="h-7 w-7 rounded-full bg-[var(--m-accent)] flex items-center justify-center shadow-xs">
                          <Play className="h-3.5 w-3.5 text-white fill-current" />
                        </button>
                        <div>
                          <span className="text-[9px] font-bold text-zinc-200 block">Listen to Track Preview</span>
                          <span className="text-[7px] text-zinc-500 block">Streaming from RPS Nodes</span>
                        </div>
                      </div>
                      <span className="text-[9px] text-zinc-400 font-mono">0:30</span>
                    </div>

                    {/* Landing Page Action List */}
                    <div className="space-y-2">
                      <div className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Portal Actions</div>
                      
                      <button 
                        onClick={handleLike}
                        className={cn(
                          "w-full py-2.5 rounded-lg text-xs font-bold flex items-center justify-between px-3 border transition-all",
                          likeClicked 
                            ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-400" 
                            : "bg-zinc-900 border-zinc-800 hover:border-[var(--m-accent)] text-zinc-100"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Heart className={cn("h-4 w-4", likeClicked ? "fill-current text-emerald-400" : "text-zinc-500")} /> 
                          {likeClicked ? 'Pre-Saved to Library' : 'Pre-Save Song'}
                        </span>
                        {!likeClicked && <span className="text-[8px] text-[var(--m-accent-2)] uppercase tracking-widest font-black font-mono">Save</span>}
                      </button>

                      <button 
                        onClick={() => handleStageChange(7)}
                        className="w-full py-2.5 bg-[var(--m-accent)] hover:bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center justify-between px-3 shadow-md transition-all border border-blue-500/30"
                      >
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" /> Join Nona Ray Fan Club
                        </span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 7: Fan Club Registration */}
              {stage === 7 && (
                <div className="flex-grow flex flex-col justify-between bg-zinc-950 text-white animate-fadeIn relative">
                  {/* Web Header */}
                  <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
                    <span className="text-[8px] font-black tracking-widest text-zinc-400 uppercase">RPS Portal Gateway</span>
                    <span className="text-[8px] text-zinc-500 font-mono">Secure Form</span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-4 py-4 space-y-4">
                    {!isRegistered ? (
                      <form onSubmit={handleRegister} className="space-y-3 text-left">
                        <div className="space-y-0.5 text-center mb-2">
                          <h3 className="text-xs font-bold text-zinc-100">{"Join Nona Ray's Fan Network"}</h3>
                          <p className="text-[8px] text-zinc-500">Opt-in to updates, tickets, and exclusive releases</p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-wide">Full Name</label>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-[var(--m-accent)]"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-wide">Mobile Line</label>
                          <input
                            type="text"
                            value="+1 281-***-9460"
                            disabled
                            className="w-full px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/80 rounded text-xs text-zinc-400 cursor-not-allowed"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-wide">Market (City)</label>
                          <input
                            type="text"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            required
                            className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-white focus:outline-none focus:border-[var(--m-accent)]"
                          />
                        </div>

                        <div className="pt-2">
                          <button
                            type="submit"
                            className="w-full py-2 bg-[var(--m-accent)] hover:bg-blue-600 rounded-lg text-xs font-bold text-white shadow-md transition-all border border-blue-500/20"
                          >
                            Verify & Join Fan Club
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="text-center py-6 space-y-4 animate-fadeIn">
                        <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-sm">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm font-bold text-zinc-100">Welcome to the Fan Club!</h3>
                          <p className="text-[9px] text-zinc-400 px-4 leading-relaxed">
                            {"You're registered for Nona Ray. We'll send the full track link via text."}
                          </p>
                        </div>
                        <button
                          onClick={() => handleStageChange(8)}
                          className="px-5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs rounded-lg font-semibold transition-all"
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
                  <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
                    <span className="text-[8px] font-black tracking-widest text-zinc-400 uppercase">RPS Viral Loop</span>
                    <span className="text-[8px] text-zinc-500 font-mono">Attributed Referrals</span>
                  </div>

                  <div className="flex-grow overflow-y-auto px-4 py-4 space-y-4">
                    <div className="text-center space-y-3">
                      <div className="h-9 w-9 bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/20 rounded-full flex items-center justify-center mx-auto text-[var(--m-accent-2)]">
                        <Share2 className="h-4.5 w-4.5" />
                      </div>
                      <div className="space-y-0.5">
                        <h3 className="text-xs font-bold text-zinc-100">Attribute This Campaign</h3>
                        <p className="text-[8px] text-zinc-500">Share your listen with friends to activate referral rewards</p>
                      </div>
                    </div>

                    {/* Mock native sharing tray */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                      <div className="grid grid-cols-4 gap-2 text-center select-none">
                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-9 w-9 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <MessageSquare className="h-4 w-4 text-cyan-400" />
                          </div>
                          <span className="text-[7px] text-zinc-400">Messages</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-9 w-9 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <span className="text-xs font-bold text-pink-400">IG</span>
                          </div>
                          <span className="text-[7px] text-zinc-400">Instagram</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-9 w-9 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <span className="text-xs font-bold text-white">𝕏</span>
                          </div>
                          <span className="text-[7px] text-zinc-400">Twitter</span>
                        </button>

                        <button 
                          onClick={handleShare}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <div className="h-9 w-9 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                            <Copy className="h-4 w-4 text-emerald-400" />
                          </div>
                          <span className="text-[7px] text-zinc-400">Copy Link</span>
                        </button>
                      </div>

                      {sharesCount > 0 && (
                        <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-2 text-center text-[10px] text-emerald-400 font-semibold animate-bounce mt-2">
                          ✓ Shared with 4 friends! (4 new attributed referrals)
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-3 shrink-0">
                    <button 
                      onClick={() => handleStageChange(9)}
                      className="w-full py-2 bg-[var(--m-accent)] hover:bg-blue-600 text-xs font-bold rounded-lg flex items-center justify-center gap-1 text-white shadow-md transition-all border border-blue-500/20"
                    >
                      Complete Attribution Packet
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 9: Summary & Complete Proof */}
              {stage === 9 && (
                <div className="flex-grow flex flex-col bg-zinc-950 text-white animate-fadeIn">
                  <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 text-center shrink-0">
                    <h3 className="text-[9px] font-black uppercase text-[var(--m-accent-2)] tracking-widest">Attribution Receipt</h3>
                  </div>

                  <div className="flex-grow overflow-y-auto p-4 space-y-4">
                    {/* Status badge */}
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-3 text-center space-y-1 shadow-sm">
                      <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-bold text-xs uppercase tracking-wide">
                        <CheckCircle2 className="h-4 w-4" /> Attribution Complete
                      </div>
                      <span className="text-[8px] text-zinc-400 font-mono block">Proof ID: rps-packet-ea712f009b</span>
                    </div>

                    {/* Receipt line items */}
                    <div className="space-y-2">
                      <div className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">Interactions Recorded</div>
                      
                      <div className="space-y-1.5 text-[10px] bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-900 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Call answered:</span>
                          <span className="font-mono text-zinc-200">Yes (00:32 duration)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Song preview delivered:</span>
                          <span className="font-mono text-zinc-200">1 (Midnight Signal)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Feedback captured:</span>
                          <span className="font-mono text-zinc-200">{"\"Love it\" (Positive)"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Branded SMS delivered:</span>
                          <span className="font-mono text-zinc-200">Yes (rps.fm/nona/midnight-signal)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Song liked:</span>
                          <span className="font-mono text-zinc-200">Yes (Platform pre-save)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Fan club signup:</span>
                          <span className="font-mono text-zinc-200">Yes (Jimbo Barnes - Dallas)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Referral shares:</span>
                          <span className="font-mono text-zinc-200">4 attributed friends</span>
                        </div>
                        <div className="flex justify-between pt-1.5 border-t border-zinc-800 text-[var(--m-accent-2)] font-bold">
                          <span>Est. Campaign Value:</span>
                          <span>$3.40</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 shrink-0">
                    <button
                      onClick={handleReplay}
                      className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 text-white transition-all shadow-md"
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
        <div className="lg:col-span-7 space-y-4 text-left">
          
          {/* Timeline Panel */}
          <div className="m-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--m-border-2)] pb-3">
              <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--m-accent-2)]" /> Live Event Attribution Timeline
              </h2>
              <span className="text-[10px] font-mono text-[var(--m-muted)]">Stage {stage} of 9</span>
            </div>

            {/* Vertically stacked timeline events */}
            <div className="relative border-l border-zinc-800 pl-4 space-y-4 py-1.5 ml-2">
              
              {/* Event 1 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(2) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(2) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(2) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">1. Human Answer Verified</h3>
                  <p className="text-[10px] text-zinc-500">Call connected to opted-in mobile line. Audio channel validated.</p>
                </div>
              </div>

              {/* Event 2 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(3) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(3) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(3) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">2. Song Preview Delivered</h3>
                  <p className="text-[10px] text-zinc-500">Audio Preview of {"\"Midnight Signal\""} streamed to caller handset.</p>
                </div>
              </div>

              {/* Event 3 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(4) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(4) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(4) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">3. Fan Feedback Captured</h3>
                  <p className="text-[10px] text-zinc-500">Voice feedback converted into positive sentiment score.</p>
                </div>
              </div>

              {/* Event 4 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(5) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(5) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(5) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">4. Branded Link Delivered</h3>
                  <p className="text-[10px] text-zinc-500">Sponsor landing page url dispatched to client mobile via SMS payload.</p>
                </div>
              </div>

              {/* Event 5 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(6) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(6) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(6) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">5. Link Opened & Verified</h3>
                  <p className="text-[10px] text-zinc-500">Link click registered on node server with UTM campaign codes.</p>
                </div>
              </div>

              {/* Event 6 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(7) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(7) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(7) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">6. Platform Save Attribute</h3>
                  <p className="text-[10px] text-zinc-500">Fan liked and pre-saved the song. DSP API sync validated.</p>
                </div>
              </div>

              {/* Event 7 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(8) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(8) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(8) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">7. Fan Club Registration Completed</h3>
                  <p className="text-[10px] text-zinc-500">Verified first-party contact lead logged inside the CRM data layer.</p>
                </div>
              </div>

              {/* Event 8 */}
              <div className="relative">
                <div className={cn(
                  "absolute -left-[21px] top-1.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                  isTimelineItemActive(9) ? "bg-emerald-600 border-emerald-500 text-white scale-110" : "bg-[var(--m-bg)] border-zinc-700"
                )}>
                  {isTimelineItemActive(9) && <span className="text-[8px] font-bold">✓</span>}
                </div>
                <div className={cn("space-y-0.5 transition-opacity duration-300", isTimelineItemActive(9) ? "opacity-100" : "opacity-35")}>
                  <h3 className="text-xs font-semibold text-zinc-200">8. Viral Share Attributed</h3>
                  <p className="text-[10px] text-zinc-500">Mock share tracking loop recorded 4 referral actions and generated a proof packet.</p>
                </div>
              </div>

            </div>
          </div>

          {/* Business Impact Card */}
          <div className="m-card p-5 bg-gradient-to-br from-[#071B36] to-[#0B2447] border-[var(--m-border)] space-y-3">
            <h3 className="text-xs font-black uppercase text-[var(--m-accent-2)] tracking-widest flex items-center gap-1.5 font-mono">
              <Sparkles className="h-4 w-4 text-amber-500 fill-current" /> Why This Matters
            </h3>
            <p className="text-xs text-zinc-200 leading-relaxed">
              RPS turns one fan phone interaction into a measurable media event: listen, feedback, click, like, signup, share, and proof. Every action becomes sponsor-ready attribution.
            </p>
            
            {/* Metric widgets */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <div className="bg-[#020817]/60 border border-[var(--m-border)] rounded p-2 text-center">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-wider block">Est. Action Value</span>
                <span className="text-sm font-bold m-font-mono text-white mt-0.5 block">$3.40</span>
              </div>
              <div className="bg-[#020817]/60 border border-[var(--m-border)] rounded p-2 text-center">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-wider block">Opt-In Rate</span>
                <span className="text-sm font-bold m-font-mono text-emerald-400 mt-0.5 block">100%</span>
              </div>
              <div className="bg-[#020817]/60 border border-[var(--m-border)] rounded p-2 text-center">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-wider block">Virality Coeff.</span>
                <span className="text-sm font-bold m-font-mono text-cyan-400 mt-0.5 block">4.0x</span>
              </div>
              <div className="bg-[#020817]/60 border border-[var(--m-border)] rounded p-2 text-center">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-wider block">Attribution</span>
                <span className="text-[10px] font-bold text-emerald-400 mt-1 block uppercase font-mono">Complete</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
