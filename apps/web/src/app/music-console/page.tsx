'use client';

import {
  Activity,
  CheckCircle2,
  DollarSign,
  FileText,
  Headphones,
  ShieldCheck,
  TrendingUp,
  Users,
  Upload,
  ArrowRight,
  Volume2,
  Play,
  Flame,
  Music,
  ChevronDown,
  ChevronUp,
  Database,
  Phone,
  MessageSquare,
  Award,
  Radio,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  campaignTimeSeries,
  funnelData,
  livePulse,
  proofRecords,
  topKpis,
  topSegmentsData,
} from '@/features/music/data/demo-music-data';
import {
  formatCompactNumber,
  formatCurrency,
  outcomeLabel,
  segmentLabel,
} from '@/features/music/lib/utils';
import {
  MetricCard,
  PremiumCard,
  StatusBadge,
  ProofBadge,
  SegmentBadge,
  ActionButton,
} from '@/features/music/components';
import { cn } from '@/lib/utils';

// Client-safe time extractor to prevent hydration warnings
const formatTimestamp = (ts: string) => {
  const parts = ts.split('T');
  if (parts.length < 2) return '';
  const time = parts[1].slice(0, 5); // extracts "HH:MM"
  const [hourStr, minStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minStr} ${ampm}`;
};

const meanings: Record<string, string> = {
  'Uploaded Fans': 'Audience list imported & normalized',
  'Contacted': 'Dialer connects established',
  'Human Answered': 'Human speech verified calls',
  'Engaged': 'Convo sustained past initial drop',
  'Verified Intent': 'Fan verbal opt-ins captured',
  'Action Taken': 'Pre-saves written to Spotify API',
};

const activityLogs: Record<number, string[]> = {
  0: [
    "04:12:05 PM — Batch import complete: 25,000 records",
    "04:12:05 PM — Consent validation check passed",
    "04:12:06 PM — List assigned to Active Campaign auto-dialer"
  ],
  1: [
    "07:51:33 PM — Outbound call initiated to +1 415-xxx-xxxx",
    "07:51:35 PM — SIP trunk routing allocated",
    "07:51:40 PM — Dial state: Ringing / No Ans (Voicemail left)"
  ],
  2: [
    "07:51:12 PM — Voice detection: Human speech verified",
    "07:51:13 PM — Live SIP stream mapped to AI audio handler",
    "07:51:15 PM — Handshake greeting executed successfully"
  ],
  3: [
    "07:50:45 PM — Conversation duration exceeded 25 seconds",
    "07:50:50 PM — Natural language engagement scored: High",
    "07:50:58 PM — Topic match: 'Midnight Signal Release'"
  ],
  4: [
    "07:50:02 PM — AI agent: 'Shall I set up the Spotify pre-save?'",
    "07:50:04 PM — Fan voice confirmed positive intent: 'Yes, do it'",
    "07:50:05 PM — Semantic analysis marked intent: High Positive"
  ],
  5: [
    "07:49:15 PM — Pre-save request payload sent to Spotify API",
    "07:49:16 PM — OAuth credential handshake confirmed",
    "07:49:16 PM — Spotify Pre-save database entry written (Success)"
  ]
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#121624]/95 border border-[var(--m-border)] backdrop-blur-md rounded-xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.5)] space-y-2">
        <p className="text-[10px] font-mono font-black text-[var(--m-muted)] uppercase tracking-wider">{label}</p>
        <div className="space-y-1.5 font-sans">
          {payload.map((pld: any) => (
            <div key={pld.dataKey} className="flex items-center gap-6 justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-2)]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pld.stroke || pld.color }} />
                {pld.name}:
              </span>
              <span className="font-mono text-xs font-black text-white">
                {pld.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

function Interactive3DGlobe() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let width = canvas.width;
    let height = canvas.height;

    // Handle resize
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      width = canvas.width;
      height = canvas.height;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    
    resize();
    window.addEventListener('resize', resize);

    // Generate points on a sphere
    const points: { x: number; y: number; z: number; type: 'grid' | 'hotspot'; pulse?: number }[] = [];
    
    // Grid points (dot mesh)
    const numPoints = 280;
    for (let i = 0; i < numPoints; i++) {
      // Golden spiral distribution
      const y = 1 - (i / (numPoints - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = 2.39996 * i; // Golden angle
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      
      points.push({ x: x * 76, y: y * 76, z: z * 76, type: 'grid' });
    }

    // Hotspots (Golden/Amber)
    const hotspots = [
      { lat: 0.6, lon: -1.2, name: 'LA' },
      { lat: 0.7, lon: -0.7, name: 'NYC' },
      { lat: 0.4, lon: -1.0, name: 'TX' },
      { lat: 0.2, lon: 0.1, name: 'LON' },
      { lat: 0.5, lon: 2.4, name: 'TKY' },
    ];

    hotspots.forEach(h => {
      const cosLat = Math.cos(h.lat);
      const x = cosLat * Math.sin(h.lon);
      const y = Math.sin(h.lat);
      const z = cosLat * Math.cos(h.lon);
      points.push({ x: x * 76, y: y * 76, z: z * 76, type: 'hotspot', pulse: Math.random() });
    });

    let angleY = 0;
    let angleX = 0.35; // slight tilt

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const w = width / window.devicePixelRatio;
      const h = height / window.devicePixelRatio;
      const centerX = w / 2;
      const centerY = h / 2;
      
      // Draw dynamic outer radar scanning sweep
      ctx.beginPath();
      ctx.arc(centerX, centerY, 88, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, 76, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Rotate and project points
      const rotatedPoints = points.map(p => {
        let x1 = p.x * Math.cos(angleY) - p.z * Math.sin(angleY);
        let z1 = p.x * Math.sin(angleY) + p.z * Math.cos(angleY);
        
        let y2 = p.y * Math.cos(angleX) - z1 * Math.sin(angleX);
        let z2 = p.y * Math.sin(angleX) + z1 * Math.cos(angleX);

        const focalLength = 250;
        const scale = focalLength / (focalLength + z2);
        const projX = centerX + x1 * scale;
        const projY = centerY + y2 * scale;
        
        return {
          projX,
          projY,
          z: z2,
          type: p.type,
          pulse: p.pulse,
          orig: p
        };
      });

      // Depth sort: background drawn first
      rotatedPoints.sort((a, b) => b.z - a.z);

      rotatedPoints.forEach(p => {
        const isForeground = p.z < 0;
        const opacity = isForeground 
          ? Math.max(0.15, 0.8 * (1 - p.z / 76)) 
          : Math.max(0.04, 0.15 * (1 - p.z / 76));

        if (p.type === 'grid') {
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(167, 139, 250, ${opacity * 0.35})`; // translucent purple dots
          ctx.fill();
        } else {
          // Hotspot
          const size = isForeground ? 3.5 : 1.5;
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, size, 0, Math.PI * 2);
          ctx.fillStyle = '#F59E0B'; // golden/amber
          ctx.fill();

          if (isForeground) {
            const pVal = (p.orig.pulse || 0) % 1;
            ctx.beginPath();
            ctx.arc(p.projX, p.projY, size + pVal * 16, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(245, 158, 11, ${1 - pVal})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            
            p.orig.pulse = (p.orig.pulse || 0) + 0.012;
          }
        }
      });

      // Draw connection lines
      const foregroundHotspots = rotatedPoints.filter(p => p.type === 'hotspot' && p.z < 0);
      for (let i = 0; i < foregroundHotspots.length; i++) {
        for (let j = i + 1; j < foregroundHotspots.length; j++) {
          const h1 = foregroundHotspots[i];
          const h2 = foregroundHotspots[j];
          const dist = Math.hypot(h1.projX - h2.projX, h1.projY - h2.projY);
          
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(h1.projX, h1.projY);
            const midX = (h1.projX + h2.projX) / 2;
            const midY = (h1.projY + h2.projY) / 2 - dist * 0.15;
            ctx.quadraticCurveTo(midX, midY, h2.projX, h2.projY);
            
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.12)';
            ctx.lineWidth = 0.8;
            ctx.setLineDash([2, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      angleY += 0.004;
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="w-full h-full relative flex items-center justify-center bg-[#07090e]/40 rounded-t-2xl border-t border-x border-white/5 overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full absolute inset-0 cursor-grab" />
      {/* HUD indicators */}
      <div className="absolute inset-x-0 bottom-6 flex justify-between px-6 pointer-events-none text-[8px] font-mono text-amber-500/50 uppercase tracking-[0.2em]">
        <span>MAP INTEL: ONLINE</span>
        <span>COORDINATES LOCK: 37.0902° N, 95.7129° W</span>
      </div>
      <div className="absolute top-4 left-6 pointer-events-none text-[8px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span>Live Telemetry Hotline Tracker</span>
      </div>
    </div>
  );
}

export default function MusicConsolePage() {
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);
  const [hoveredStageIndex, setHoveredStageIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const togglePlay = (id: string) => {
    setPlayingRecordId(playingRecordId === id ? null : id);
  };

  const toggleTranscript = (id: string) => {
    setExpandedTranscriptId(expandedTranscriptId === id ? null : id);
  };

  return (
    <div className="space-y-12 pb-16">
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      <section className="m-hardware-panel text-[var(--m-text)] p-8 lg:p-10 relative overflow-hidden m-animate-fade-in m-anim-delay-100">
        {/* Glow Highlights */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#8B5CF6]/5 rounded-full blur-[120px] pointer-events-none opacity-40" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[var(--m-accent-2)]/5 rounded-full blur-[90px] pointer-events-none opacity-30" />

        <div className="relative z-10 space-y-6">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[var(--m-border-2)] pb-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-black tracking-[0.25em] text-[#A78BFA] uppercase bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-2.5 py-0.5 rounded">
                  ACTIVE CAMPAIGN
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--m-accent-2)]/20 bg-[var(--m-accent-2)]/10 text-xs font-semibold text-[var(--m-accent-2)]">
                  <span className="m-pulse-dot h-1.5 w-1.5" />
                  <span className="font-mono text-[9px] uppercase tracking-wider">{livePulse.status}</span>
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight m-title-glow">
                {livePulse.campaignName} by {livePulse.artist}
              </h1>
            </div>

            {/* CTAs */}
            <div className="flex items-center gap-3 shrink-0 self-start md:self-end">
              <Link href="/music-console/proof">
                <ActionButton variant="primary" className="text-xs font-semibold py-2.5 px-4 shadow-[0_4px_16px_rgba(139,92,246,0.2)] hover:shadow-[0_6px_20px_rgba(139,92,246,0.35)] m-btn-interactive-glow">
                  View Proof Log <ArrowRight className="h-3.5 w-3.5" />
                </ActionButton>
              </Link>
              <Link href="/music-console/reports">
                <button className="text-xs font-semibold py-2.5 px-4 rounded-lg bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all m-btn-interactive-glow">
                  Open Reports
                </button>
              </Link>
            </div>
          </div>

          {/* 6 Core KPIs Grid (Premium Redesigned Horizontal Strip) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 pt-4">
            
            {/* KPI 1: Reached Fans */}
            <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.fansContacted.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <Users className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Reached Fans
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.fansContacted.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-1">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 18 Q20 22 40 10 T80 12 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-1)" />
                    <path d="M0 18 Q20 22 40 10 T80 12 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-1)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 2: Human Answers */}
            <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.humanAnswers.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <Headphones className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Human Answers
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.humanAnswers.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-2">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 16 Q15 6 45 18 T75 8 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-2)" />
                    <path d="M0 16 Q15 6 45 18 T75 8 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-2)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 3: Verified Actions */}
            <div className="m-inset-card hover:border-[var(--m-accent-2)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent-2)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent-2)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-accent-2)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.verifiedEngagements.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent-2)] group-hover:scale-110 transition-transform duration-300">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Verified Actions
                  </span>
                  <span className="text-[9px] text-[var(--m-accent-2)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-accent-2)]/10 border border-[var(--m-accent-2)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.verifiedEngagements.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-3" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent-2)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent-2)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-3">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 20 Q25 15 50 8 T75 12 T100 3 L100 24 L0 24 Z" fill="url(#glow-kpi-3)" />
                    <path d="M0 20 Q25 15 50 8 T75 12 T100 3" stroke="var(--m-accent-2)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-3)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 4: Pre-Saves */}
            <div className="m-inset-card hover:border-[var(--m-accent-2)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent-2)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent-2)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.preSaves.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent-2)] group-hover:scale-110 transition-transform duration-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Pre-Saves
                  </span>
                  <span className="text-[9px] text-[var(--m-accent-2)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-accent-2)]/10 border border-[var(--m-accent-2)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.preSaves.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-4" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent-2)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent-2)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-4">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 16 Q20 12 40 16 T80 6 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-4)" />
                    <path d="M0 16 Q20 12 40 16 T80 6 T100 2" stroke="var(--m-accent-2)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-4)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 5: Cost / Pre-Save */}
            <div className="m-inset-card hover:border-[var(--m-warning)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-warning)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-warning)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-warning)] tracking-tight leading-none">
                    {formatCurrency(topKpis.costPerPreSave.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-warning)] group-hover:scale-110 transition-transform duration-300">
                    <DollarSign className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Cost / Pre-Save
                  </span>
                  <span className="text-[9px] text-[var(--m-warning)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-warning)]/10 border border-[var(--m-warning)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3 rotate-180" /> {topKpis.costPerPreSave.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-5" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-warning)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-warning)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-5">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 2 Q20 4 40 16 T80 10 T100 20 L100 24 L0 24 Z" fill="url(#glow-kpi-5)" />
                    <path d="M0 2 Q20 4 40 16 T80 10 T100 20" stroke="var(--m-warning)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-5)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 6: Proof Records */}
            <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[#A78BFA] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.proofCaptured.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <FileText className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Proof Records
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.proofCaptured.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-6" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-6">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 18 Q20 16 40 10 T80 8 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-6)" />
                    <path d="M0 18 Q20 16 40 10 T80 8 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-6)" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: Stepped Fan Journey Path (Redesigned Flow Timeline) ─── */}
      <section className="space-y-4 m-animate-fade-in m-anim-delay-200">
        <div className="flex items-center justify-between px-1">
          <div className="space-y-1">
            <h3 className="text-xs font-black tracking-[0.2em] text-[var(--m-muted)] uppercase">
              Stepped Fan Journey Path
            </h3>
            <p className="text-[11px] text-[var(--m-muted)]">
              Multi-channel conversion funnel mapping audience progression from contact to conversion.
            </p>
          </div>
          <span className="text-[10px] font-mono font-bold text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-2.5 py-1 rounded">
            Campaign Mode: AI Dialing
          </span>
        </div>

        <div className="m-hardware-panel p-6 overflow-hidden">
          <div className="overflow-x-auto m-scrollbar-thin pb-2 relative">
            <div className="flex items-center justify-between min-w-[1000px] lg:min-w-0 px-4 py-8 relative">
            {funnelData.map((stage, i) => {
              // Custom Lucide icons for each stage
              const icons = [
                <Upload className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <Phone className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <Headphones className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <MessageSquare className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <ShieldCheck className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <CheckCircle2 className="h-4.5 w-4.5" style={{ color: stage.color }} />,
              ];

              return (
                <React.Fragment key={stage.label}>
                  {/* Milestone Node */}
                  <div
                    className="relative flex flex-col items-center group cursor-pointer"
                    onMouseEnter={() => setHoveredStageIndex(i)}
                    onMouseLeave={() => setHoveredStageIndex(null)}
                  >
                    {/* Rich Floating Tooltip */}
                    {hoveredStageIndex === i && (
                      <div className="absolute bottom-[110%] left-1/2 -translate-x-1/2 w-80 bg-[var(--m-surface)] border border-[var(--m-border)] rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)] z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center justify-between mb-3 border-b border-[var(--m-border-2)] pb-2">
                          <span className="text-[9px] font-mono font-black tracking-wider uppercase text-[var(--m-muted)]">
                            STAGE 0{i + 1} INTEL
                          </span>
                          <span
                            className="px-2 py-0.5 rounded text-[9px] font-mono font-bold border"
                            style={{
                              backgroundColor: `${stage.color}15`,
                              borderColor: `${stage.color}35`,
                              color: stage.color
                            }}
                          >
                            {stage.percentage.toFixed(1)}% Conversion
                          </span>
                        </div>

                        <h4 className="text-xs font-black uppercase text-[var(--m-text)] tracking-wider">
                          {stage.label}
                        </h4>
                        <p className="text-[10px] text-[var(--m-muted)] mt-0.5 leading-snug">
                          {meanings[stage.label] || stage.label}
                        </p>

                        <div className="grid grid-cols-2 gap-4 py-3 my-3 border-y border-[var(--m-border-2)]">
                          <div>
                            <div className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Volume</div>
                            <div className="text-base font-mono font-extrabold text-[var(--m-text)] mt-0.5">
                              {stage.count.toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Drop-off</div>
                            <div className="text-base font-mono font-extrabold text-[var(--m-danger)] mt-0.5">
                              {i === 0 ? "0%" : `-${(((funnelData[i-1].count - stage.count) / funnelData[i-1].count) * 100).toFixed(0)}%`}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--m-accent-2)]">
                            Telemetry Feed
                          </div>
                          <div className="space-y-1 font-mono text-[9px] leading-relaxed text-[var(--m-muted)]">
                            {activityLogs[i]?.map((log, index) => (
                              <div key={index} className="flex items-start gap-1">
                                <span className="text-[var(--m-accent-2)]">▸</span>
                                <span className="truncate">{log}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Diffused colored glow behind the milestone */}
                    <div
                      className="absolute w-16 h-16 rounded-full blur-xl opacity-15 group-hover:opacity-30 transition-all duration-300 pointer-events-none"
                      style={{ backgroundColor: stage.color }}
                    />

                    {/* Circular milestone node */}
                    <div
                      className="relative w-16 h-16 rounded-full flex items-center justify-center m-glass-node transition-all duration-300 group-hover:scale-110"
                      style={{
                        borderColor: stage.color,
                        boxShadow: `0 0 16px ${stage.color}50, inset 0 1px 2px rgba(255, 255, 255, 0.15)`
                      }}
                    >
                      {/* Pulsing ring animation */}
                      <div
                        className="absolute inset-0 rounded-full animate-ping opacity-20 pointer-events-none"
                        style={{ backgroundColor: stage.color, animationDuration: '3s' }}
                      />

                      {/* Icon container */}
                      <div className="w-11 h-11 rounded-full flex items-center justify-center bg-zinc-900/80 border border-white/5 shadow-inner">
                        {icons[i] || <Activity className="h-4 w-4" />}
                      </div>

                      {/* Stage percentage floating badge */}
                      <div
                        className="absolute -top-1 -right-1 text-[8px] font-black font-mono px-1.5 py-0.5 rounded-full border text-white"
                        style={{ backgroundColor: stage.color, borderColor: 'var(--m-bg)' }}
                      >
                        {stage.percentage.toFixed(0)}%
                      </div>
                    </div>

                    {/* Label and numbers below */}
                    <div className="mt-3.5 text-center space-y-1">
                      <span className="text-[8px] font-mono font-black text-[var(--m-muted)] tracking-widest uppercase block">
                        STAGE 0{i + 1}
                      </span>
                      <span className="text-[10px] font-black text-[var(--m-text)] tracking-wider uppercase block max-w-[110px] truncate group-hover:text-[var(--m-accent)] transition-colors duration-300">
                        {stage.label}
                      </span>
                      <div className="flex items-center justify-center gap-1.5 mt-0.5">
                        <span className="text-xs font-bold font-mono text-[var(--m-text-2)]">
                          {formatCompactNumber(stage.count)}
                        </span>
                        <span className="text-[9px] font-mono font-bold text-zinc-600">•</span>
                        <span className="text-[10px] font-mono font-black text-[#A78BFA]" style={{ color: stage.color }}>
                          {stage.percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Connected line with running flow telemetry dot */}
                  {i < funnelData.length - 1 && (
                    <div className="flex-1 min-w-[30px] max-w-[90px] h-[6px] relative mx-2 z-0 hidden md:block">
                      <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 6">
                        <path 
                          d="M 0,3 L 94,3 M 90,0 L 95,3 L 90,6" 
                          stroke={`url(#arrow-grad-${i})`} 
                          strokeWidth="2.5" 
                          fill="none" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                        />
                        <defs>
                          <linearGradient id={`arrow-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor={stage.color} />
                            <stop offset="100%" stopColor={funnelData[i+1]?.color || stage.color} />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full animate-flow-dot pointer-events-none"
                        style={{
                          backgroundColor: funnelData[i+1]?.color || stage.color,
                          boxShadow: `0 0 8px ${funnelData[i+1]?.color || stage.color}`
                        }}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 4: Timeline Chart & Section 5: Segment Heat ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 m-animate-fade-in m-anim-delay-300">
        {/* Live Campaign Movement with side-by-side grid composition */}
        <div className="lg:col-span-2 m-card p-8 lg:p-10 flex flex-col bg-[var(--m-surface)] relative overflow-hidden group">
          {/* Subtle background mesh glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-[var(--m-accent)]/5 rounded-full blur-[80px] pointer-events-none opacity-30" />

          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[var(--m-border-2)] pb-5 mb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--m-accent-2)] animate-pulse" />
                <span className="text-[9px] font-black tracking-[0.2em] text-[var(--m-accent-2)] uppercase">
                  REAL-TIME TELEMETRY FEED
                </span>
              </div>
              <h2 className="m-section-title text-base font-black">
                <Activity className="h-4.5 w-4.5 text-[var(--m-accent)] animate-pulse" /> Live Campaign Movement
              </h2>
              <p className="m-section-subtitle">
                Geographic attribution surge tracking call answer rate vs pre-save completions.
              </p>
            </div>

            {/* Live Metrics Overlay */}
            <div className="flex items-center flex-wrap gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-dim)] text-[10px] font-bold text-[var(--m-accent)] border border-[var(--m-accent)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-accent)]" />
                {livePulse.answerRate}% Connects
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-2-dim)] text-[10px] font-bold text-[var(--m-accent-2)] border border-[var(--m-accent-2)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-accent-2)]" />
                {livePulse.verifiedRate}% Conversions
              </span>
            </div>
          </div>

          {/* Grid split inside card to prevent any vertical empty space */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-stretch flex-1">
            {/* Left Analyst Insight Column */}
            <div className="md:col-span-1 flex flex-col justify-between space-y-4">
              <div className="bg-[var(--m-surface-2)] p-4 rounded-xl border border-[var(--m-border)] space-y-3 shadow-xs">
                <div className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-widest text-[var(--m-muted)] border-b border-[var(--m-border)] pb-1.5">
                  <Flame className="w-3.5 h-3.5 text-[var(--m-warning)] animate-bounce" /> Telemetry Insight
                </div>
                <p className="text-xs text-[var(--m-text-2)] leading-relaxed font-medium">
                  Verified activations peaked on April 22 following the <strong>North American Tour On-Sale</strong> launch, showing an 18.4% conversion rate surge.
                </p>
              </div>

              <div className="space-y-2 p-3 bg-[var(--m-surface-2)]/60 rounded-xl border border-[var(--m-border-2)]">
                <div className="text-[9px] font-extrabold tracking-widest text-[var(--m-muted)] uppercase">Voice Node Status</div>
                <div className="flex items-center justify-between text-xs font-bold text-[var(--m-text-2)]">
                  <div className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[var(--m-accent)] animate-pulse" />
                    <span>Active Dials</span>
                  </div>
                  <span className="font-mono text-[var(--m-accent)]">24/s</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-[var(--m-text-2)]">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[var(--m-accent-2)]" />
                    <span>Ping Latency</span>
                  </div>
                  <span className="font-mono text-[var(--m-accent-2)]">12ms</span>
                </div>
              </div>

              <div className="space-y-2 p-3 bg-[var(--m-surface-2)]/60 rounded-xl border border-[var(--m-border-2)]">
                <div className="text-[9px] font-extrabold tracking-widest text-[var(--m-muted)] uppercase font-bold">Queue Diagnostics</div>
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--m-text-2)]">
                  <span>Queue Size</span>
                  <span className="font-mono text-[var(--m-text)]">4,124</span>
                </div>
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--m-text-2)]">
                  <span>Avg Duration</span>
                  <span className="font-mono text-[var(--m-text)]">48s</span>
                </div>
              </div>
            </div>

            {/* Right Chart & Ticker Column */}
            <div className="md:col-span-3 flex flex-col justify-between space-y-6">
              {/* Chart Canvas */}
              <div className="h-[220px] w-full relative flex items-center justify-center m-card-deep p-4 overflow-hidden">
                {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={campaignTimeSeries}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#9F7AEA" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#9F7AEA" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                        </linearGradient>
                        {/* Glow filters for lines */}
                        <filter id="chart-line-glow" x="-10%" y="-10%" width="120%" height="120%">
                          <feGaussianBlur stdDeviation="2" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="4 4"
                        vertical={false}
                        stroke="rgba(255, 255, 255, 0.025)"
                      />
                      <XAxis
                        dataKey="date"
                        stroke="var(--m-dim)"
                        tick={{ fontSize: 10, fill: 'var(--m-muted)', fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="var(--m-dim)"
                        tick={{ fontSize: 10, fill: 'var(--m-muted)', fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="humanAnswers"
                        name="Human Answers"
                        stroke="#9F7AEA"
                        strokeWidth={3.5}
                        fillOpacity={1}
                        fill="url(#colorAnswers)"
                        filter="url(#chart-line-glow)"
                        activeDot={{ r: 6, stroke: '#121624', strokeWidth: 2, fill: '#9F7AEA' }}
                        dot={{ r: 3, stroke: '#9F7AEA', strokeWidth: 1.5, fill: '#121624' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="verifiedEngagements"
                        name="Verified Actions"
                        stroke="#06B6D4"
                        strokeWidth={3.5}
                        fillOpacity={1}
                        fill="url(#colorVerified)"
                        filter="url(#chart-line-glow)"
                        activeDot={{ r: 6, stroke: '#121624', strokeWidth: 2, fill: '#06B6D4' }}
                        dot={{ r: 3, stroke: '#06B6D4', strokeWidth: 1.5, fill: '#121624' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-xs text-[var(--m-muted)] font-mono animate-pulse">Loading telemetry signal charts...</div>
                )}
              </div>

              {/* Globe & Terminal Collar Wrapper Container */}
              <div className="flex flex-col relative">
                {/* High-Performance Interactive 3D Globe */}
                <div className="h-[240px] w-full relative z-0">
                  <Interactive3DGlobe />
                </div>

                {/* Cylindrical Terminal Collar */}
                <div className="m-terminal-container m-terminal-collar rounded-b-2xl w-full overflow-hidden shadow-2xl relative -mt-6 z-10">
                  {/* macOS window title bar */}
                  <div className="bg-[#0D0E12]/80 px-4 py-2.5 flex items-center justify-between border-b border-white/5 relative z-10 backdrop-blur-md">
                    <div className="flex items-center gap-1.5 select-none">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]/90" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]/90" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]/90" />
                    </div>
                    <span className="text-[9px] font-mono font-bold tracking-widest text-[var(--m-muted)] uppercase select-none">
                      telemetry@hopwhistle: ~/live-logs
                    </span>
                    <span className="text-[8px] font-mono px-2 py-0.5 rounded bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/25 uppercase tracking-widest font-black animate-pulse">
                      FEED NOMINAL
                    </span>
                  </div>

                  {/* Active Live Metric Tickers */}
                  <div className="bg-[#05070a]/90 px-4 py-1.5 border-b border-white/5 flex items-center justify-between text-[9px] font-mono text-amber-500/80 tracking-wider z-10 relative">
                    <div className="flex gap-4">
                      <span>QUEUE: <span className="text-[#34D399] font-bold">4,124</span></span>
                      <span>LATENCY: <span className="text-[#34D399] font-bold">12ms</span></span>
                      <span>ACTIVE CALLS: <span className="text-amber-400 font-bold">18</span></span>
                    </div>
                    <div>
                      <span>STATUS: <span className="text-[#34D399] font-bold">ONLINE</span></span>
                    </div>
                  </div>

                  {/* CRT Terminal Screen content with vertical scrolling logs */}
                  <div className="p-5 space-y-2.5 font-mono text-[10px] leading-relaxed text-[#34D399] min-h-[140px] select-all relative z-10">
                    <div className="flex items-start gap-2.5">
                      <span className="text-emerald-500/40">[17:54:12]</span>
                      <span className="m-terminal-text-purple font-black uppercase tracking-wider">▸ OUTBOUND:</span>
                      <span className="m-terminal-text-green font-medium">Initiated contact route for +1865***1182 (Superfans tier) -> Ringing...</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-emerald-500/40">[17:54:18]</span>
                      <span className="m-terminal-text-purple font-black uppercase tracking-wider">▸ ANSWERED:</span>
                      <span className="m-terminal-text-green font-medium">Connect established on Node 02 for +1551***6220 -> Speech synthesis running...</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-emerald-500/40">[17:54:25]</span>
                      <span className="m-terminal-text-amber font-black uppercase tracking-wider">▸ INTENT:</span>
                      <span className="m-terminal-text-amber font-bold">Fan verbal intent captured (Confidence: 94.2%) -> dispatching pre-save hook.</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-emerald-500/40">[17:54:32]</span>
                      <span className="text-[#10B981] font-black uppercase tracking-wider">✔ SUCCESS:</span>
                      <span className="text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)] font-extrabold">Pre-save completed. CPA attribution: $0.25 (Transaction ref: tx_815a5f70)<span className="m-terminal-cursor" /></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Audience Heat Board */}
        <div className="m-card p-8 lg:p-10 flex flex-col bg-[var(--m-surface)] relative overflow-hidden group">
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-[var(--m-warning)]/5 rounded-full blur-[80px] pointer-events-none opacity-20" />

          {/* Section Header */}
          <div className="space-y-1 mb-6 border-b border-[var(--m-border-2)] pb-5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black tracking-[0.2em] text-[var(--m-warning)] uppercase">
                COHORT CLASSIFICATION
              </span>
            </div>
            <h2 className="m-section-title text-base font-black">
              <Flame className="h-4.5 w-4.5 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target cohorts sorted by engagement metrics.</p>
          </div>

          <div className="space-y-4 flex-1 justify-center flex flex-col mt-4">
            {topSegmentsData.map((seg, i) => {
              const captions: Record<string, string> = {
                Superfans: 'High-frequency stream & social tier',
                'Stream save audience': 'Prior cycle pre-save responders',
                'VIP list': 'Opted-in SMS premium members',
                'Previous merch buyers': 'Purchased apparel, prints, or vinyl',
                'Tour city fans': 'Within 50 miles of stopping venues',
                'Fan club inactive': 'Dormant registers targeted to reactivate',
              };

              const recommendations: Record<string, string> = {
                Superfans: 'ACTION REQ: DISPATCH EARLY TICKET ON-SALE',
                'Stream save audience': 'ACTION REQ: ACTIVATE ALBUM PRE-SAVE FLOW',
                'VIP list': 'ACTION REQ: QUEUE VIP UPGRADE CAMPAIGN',
                'Previous merch buyers': 'ACTION REQ: DISPATCH CAPSULE MERCH ALERT',
                'Tour city fans': 'ACTION REQ: BROADCAST VENUE TOUR COORDINATES',
                'Fan club inactive': 'ACTION REQ: INITIATE WIN-BACK WORKFLOW',
              };

              // Determine Heat Colors and Icons based on engagement score
              const isCrit = seg.engagement >= 80;
              const isWarm = seg.engagement >= 60 && seg.engagement < 80;
              
              const borderHighlight = isCrit
                ? 'hover:border-[#FBBF24]/50'
                : isWarm
                  ? 'hover:border-[#C084FC]/50'
                  : 'hover:border-[#06B6D4]/50';

              const rankGlow = isCrit
                ? 'text-[#FBBF24] border-[#FBBF24]/20 bg-[#FBBF24]/10 shadow-[0_0_6px_rgba(251,191,36,0.15)]'
                : isWarm
                  ? 'text-[#C084FC] border-[#C084FC]/20 bg-[#C084FC]/10 shadow-[0_0_6px_rgba(192,132,252,0.15)]'
                  : 'text-[#06B6D4] border-[#06B6D4]/20 bg-[#06B6D4]/10 shadow-[0_0_6px_rgba(6,182,212,0.15)]';

              const tempBadge = isCrit
                ? 'text-[#FBBF24] bg-[#FBBF24]/10 border-[#FBBF24]/25 shadow-[0_0_8px_rgba(251,191,36,0.15)]'
                : isWarm
                  ? 'text-[#C084FC] bg-[#C084FC]/10 border-[#C084FC]/25 shadow-[0_0_8px_rgba(192,132,252,0.15)]'
                  : 'text-[#06B6D4] bg-[#06B6D4]/10 border-[#06B6D4]/25 shadow-[0_0_8px_rgba(6,182,212,0.15)]';

              return (
                <div
                  key={seg.segment}
                  className={cn(
                    "m-inset-card p-5 flex flex-col justify-between space-y-4 hover:shadow-[0_20px_35px_-8px_rgba(0,0,0,0.55)] hover:-translate-y-1.5 hover:scale-[1.01] relative overflow-hidden group",
                    borderHighlight
                  )}
                >
                  {/* Subtle dynamic hover glow layer that corresponds to cohort heat */}
                  <div
                    className={cn(
                      "absolute -right-8 -bottom-8 w-24 h-24 rounded-full blur-xl transition-all duration-500 pointer-events-none opacity-5 group-hover:opacity-20",
                      isCrit
                        ? "bg-[#FBBF24]"
                        : isWarm
                          ? "bg-[#C084FC]"
                          : "bg-[#06B6D4]"
                    )}
                  />

                  {/* Top: Rank, Title and Temp Badge */}
                  <div className="flex items-start justify-between gap-3 relative z-10">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={cn("w-7 h-7 flex items-center justify-center border rounded-lg text-xs font-mono font-black group-hover:scale-105 transition-transform", rankGlow)}>
                        0{i + 1}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-black text-[var(--m-text)] tracking-wide uppercase group-hover:text-[var(--m-text-2)] transition-colors block truncate">{seg.segment}</span>
                        <span className="text-[9px] text-[var(--m-muted)] leading-tight block truncate mt-0.5">{captions[seg.segment] || 'Target audience segment'}</span>
                      </div>
                    </div>
                    <span className={cn("text-[8px] font-mono font-black px-2 py-0.5 rounded border tracking-wider shrink-0", tempBadge)}>
                      {seg.engagement}% HEAT
                    </span>
                  </div>

                  {/* Mid: Stats Row */}
                  <div className="grid grid-cols-2 gap-4 pt-1 relative z-10">
                    <div className="bg-[var(--m-surface-2)]/60 border border-[var(--m-border-2)] rounded-lg p-2.5 flex flex-col group-hover:bg-[var(--m-surface-3)] transition-colors">
                      <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Volume</span>
                      <span className="font-mono text-[10.5px] font-extrabold text-[var(--m-text-2)] mt-0.5">{formatCompactNumber(seg.count)} Fans</span>
                    </div>
                    <div className="bg-[var(--m-surface-2)]/60 border border-[var(--m-border-2)] rounded-lg p-2.5 flex flex-col group-hover:bg-[var(--m-surface-3)] transition-colors">
                      <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Target Goal</span>
                      <span className="font-mono text-[10.5px] font-extrabold text-[var(--m-text-2)] mt-0.5">{seg.engagement}% Engagement</span>
                    </div>
                  </div>

                  {/* Heat Map LED Indicator Grid & Progress bar */}
                  <div className="space-y-2.5 relative z-10">
                    <div className="flex justify-between items-center text-[8px] font-black tracking-wider text-[var(--m-muted)] uppercase">
                      <span>Goal Progress</span>
                      <span className="font-mono text-amber-500 font-extrabold">{seg.engagement}%</span>
                    </div>
                    
                    {/* Segmented Orange/Amber Multi-Bar Horizontal Meter */}
                    <div className="flex items-center gap-1 bg-black/40 border border-white/[0.03] p-1 rounded-md h-4.5">
                      {Array.from({ length: 15 }).map((_, idx) => {
                        const threshold = ((idx + 1) / 15) * 100;
                        const isLit = seg.engagement >= threshold;
                        
                        return (
                          <div
                            key={idx}
                            className={cn(
                              "h-full w-full rounded-xs transition-all duration-300",
                              isLit 
                                ? "bg-gradient-to-t from-[#D97706] to-[#FBBF24] shadow-[0_0_4px_rgba(245,158,11,0.5)] opacity-100" 
                                : "bg-amber-950/10 opacity-30"
                            )}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Recommendation action tag: elegant small tag */}
                  <div className="text-[8px] font-black text-center text-[var(--m-muted)] bg-[var(--m-surface-2)]/60 border border-[var(--m-border)] rounded-lg px-2.5 py-1.5 tracking-widest uppercase transition-all duration-300 group-hover:border-[var(--m-accent-2)]/30 group-hover:bg-[var(--m-accent-2-dim)] group-hover:text-[var(--m-accent-2)] relative z-10">
                    {recommendations[seg.segment] || 'ACTION REQ: DISPATCH OUTREACH'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: Fan Proof Stream (Proof records coming back) ─── */}
      <section className="m-card p-8 lg:p-10 bg-[var(--m-surface)] m-animate-fade-in m-anim-delay-400">
        <div className="border-b border-[var(--m-border-2)] pb-4 mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="m-section-title">
              <ShieldCheck className="h-4.5 w-4.5 text-[var(--m-accent-2)]" /> Proof Coming Back from the Audience
            </h2>
            <p className="m-section-subtitle">
              Verified outcomes, recording proofs, sentiment ratings, and attributed conversions.
            </p>
          </div>
          <Link href="/music-console/proof">
            <ActionButton variant="secondary" className="text-xs font-bold py-2 border border-black/10 m-btn-interactive-glow">
              Open Full Proof Log <ArrowRight className="h-3.5 w-3.5" />
            </ActionButton>
          </Link>
        </div>

        {/* Proof Stream Container */}
        <div className="space-y-4">
          {proofRecords.slice(0, 6).map(r => {
            const isPlaying = playingRecordId === r.id;
            const isExpanded = expandedTranscriptId === r.id;

            const accentColor =
              r.sentiment === 'positive'
                ? 'bg-[var(--m-accent-2)]'
                : r.sentiment === 'negative'
                  ? 'bg-[#EF4444]'
                  : 'bg-[var(--m-muted)]';

            return (
              <div
                key={r.id}
                className="m-proof-track pl-6 p-5 group relative overflow-hidden"
              >
                {/* Sentiment vertical bar indicator */}
                <div className={cn('m-proof-card-accent-bar w-1.5', accentColor)} />

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pr-2 group-hover:pr-24 transition-all duration-300">
                  {/* Left Column: Fan Identity */}
                  <div className="lg:col-span-4 space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm text-[var(--m-text)]">{r.fanName}</span>
                      <span className="font-mono text-xs text-[var(--m-muted)] bg-black/40 border border-white/5 px-1.5 py-0.5 rounded">
                        xxxxxx{r.fanPhone.slice(-4)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SegmentBadge segment={r.segment} />
                      <span
                        className={cn(
                          'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border font-mono',
                          r.intent === 'high'
                            ? 'bg-[#06B6D4]/20 text-cyan-300 border-[#06B6D4]/30'
                            : r.intent === 'medium'
                              ? 'bg-[#FBBF24]/20 text-amber-300 border-[#FBBF24]/30'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        )}
                      >
                        {r.intent} intent
                      </span>
                    </div>
                  </div>

                  {/* Middle Column: Campaign and Cost metrics */}
                  <div className="lg:col-span-4 space-y-1">
                    <div className="text-xs text-[var(--m-muted)] font-medium">
                      Campaign: <strong className="text-[var(--m-text-2)] font-semibold">{r.campaignName}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold text-[var(--m-muted)] tracking-wider">CPA Attribution:</span>
                      <span className="font-mono text-xs font-bold text-[var(--m-warning)] bg-[#F59E0B]/10 border border-[#F59E0B]/20 px-2 py-0.5 rounded">
                        {formatCurrency(r.cpaAttribution)}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Badges and Controls */}
                  <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-3">
                    <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                    
                    <div className="flex items-center gap-2 ml-auto lg:ml-0 transition-opacity duration-300 group-hover:opacity-10">
                      {/* Audio Proof Toggle */}
                      {r.hasRecording && (
                        <button
                          onClick={() => togglePlay(r.id)}
                          className={cn(
                            "text-[10px] font-bold px-3 py-1 flex items-center gap-2 rounded-full border transition-all duration-300 tracking-wider uppercase font-mono shadow-sm",
                            isPlaying
                              ? "bg-[#7C3AED] text-white border-[#8B5CF6] shadow-[0_0_8px_rgba(139,92,246,0.4)]"
                              : "bg-[#8B5CF6] text-white border-[#7C3AED] hover:bg-[#7C3AED]"
                          )}
                        >
                          {isPlaying ? (
                            <>
                              <div className="m-equalizer mb-[1px]">
                                <span className="m-equalizer-bar" style={{ backgroundColor: '#fff' }} />
                                <span className="m-equalizer-bar" style={{ backgroundColor: '#fff' }} />
                                <span className="m-equalizer-bar" style={{ backgroundColor: '#fff' }} />
                              </div>
                              <span>Playing</span>
                            </>
                          ) : (
                            <>
                              <Headphones className="h-3.5 w-3.5 text-white" />
                              <span>Audio Proof</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Transcript Toggle */}
                      {r.hasTranscript && (
                        <button
                          onClick={() => toggleTranscript(r.id)}
                          className={cn(
                            "px-3 py-1 rounded-full border transition-all duration-300 flex items-center justify-center gap-1.5 text-[10px] font-bold tracking-wider uppercase font-mono shadow-sm",
                            isExpanded 
                              ? "bg-[#4F46E5] text-white border-[#6366F1] shadow-[0_0_8px_rgba(99,102,241,0.4)]" 
                              : "bg-[#6366F1] text-white border-[#4F46E5] hover:bg-[#4F46E5]"
                          )}
                          title="Verbatim Transcript"
                        >
                          <FileText className="h-3.5 w-3.5 text-white" />
                          <span>Audit</span>
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3 text-white" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-white" />
                          )}
                        </button>
                      )}

                      <span className="text-[10px] font-mono text-[var(--m-muted)] font-medium pl-1 whitespace-nowrap">
                        {formatTimestamp(r.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Slide-in Action Icons on Hover */}
                <div className="absolute right-0 top-0 bottom-0 flex items-center gap-2 pl-4 pr-6 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 bg-gradient-to-l from-[var(--m-surface-2)] via-[var(--m-surface-2)]/95 to-transparent z-20 pointer-events-none group-hover:pointer-events-auto">
                  {r.hasRecording && (
                    <button
                      onClick={() => togglePlay(r.id)}
                      className={cn(
                        "p-2.5 rounded-lg border transition-all duration-300 hover:scale-105 active:scale-95 shadow-md",
                        isPlaying 
                          ? "bg-[#8B5CF6] border-[#8B5CF6] text-white" 
                          : "bg-[var(--m-surface-3)] border-[var(--m-border)] text-[#A78BFA] hover:bg-[#8B5CF6]/20 hover:border-[#8B5CF6]/40"
                      )}
                      title={isPlaying ? "Stop Audio" : "Listen Audio Proof"}
                    >
                      <Headphones className="h-4.5 w-4.5" />
                    </button>
                  )}
                  {r.hasTranscript && (
                    <button
                      onClick={() => toggleTranscript(r.id)}
                      className={cn(
                        "p-2.5 rounded-lg border transition-all duration-300 hover:scale-105 active:scale-95 shadow-md",
                        isExpanded 
                          ? "bg-[#8B5CF6] border-[#8B5CF6] text-white" 
                          : "bg-[var(--m-surface-3)] border-[var(--m-border)] text-[#A78BFA] hover:bg-[#8B5CF6]/20 hover:border-[#8B5CF6]/40"
                      )}
                      title={isExpanded ? "Close Audit Logs" : "View Audit Logs"}
                    >
                      <ShieldCheck className="h-4.5 w-4.5" />
                    </button>
                  )}
                  <Link href={`/music-console/proof?id=${r.id}`}>
                    <button className="p-2.5 rounded-lg border bg-[var(--m-surface-3)] border-[var(--m-border)] text-[#A78BFA] hover:bg-[#8B5CF6]/20 hover:border-[#8B5CF6]/40 hover:scale-105 active:scale-95 transition-all duration-300 shadow-md" title="View Details">
                      <Eye className="h-4.5 w-4.5" />
                    </button>
                  </Link>
                </div>

                {/* Simulated Audio Waveform player overlay */}
                {isPlaying && (
                  <div className="mt-4 p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg flex items-center gap-4 animate-fadeIn">
                    <Volume2 className="h-4.5 w-4.5 text-[var(--m-accent)] animate-bounce shrink-0" />
                    <div className="flex-1 h-1 bg-[var(--m-surface-3)] rounded-full overflow-hidden relative">
                      <div className="h-full bg-[var(--m-accent)] w-1/3 animate-[pulse_2s_infinite]" />
                    </div>
                    <span className="text-[10px] font-mono text-[var(--m-muted)] font-bold shrink-0">0:14 / 1:24</span>
                  </div>
                )}

                {/* Monospaced Audit Log Transcript snippets */}
                {isExpanded && r.transcriptSnippet && (
                  <div className="mt-4 p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg space-y-2 text-xs font-medium">
                    <div className="text-[9px] uppercase tracking-widest font-black text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-2 mb-2">
                      Verbatim Conversation Audit Log
                    </div>
                    {r.transcriptSnippet.split('\n').map((line, idx) => {
                      const isAi = line.startsWith('AI:');
                      const speaker = isAi ? 'Operator AI' : 'Fan';
                      const text = isAi
                        ? line.replace('AI:', '').trim()
                        : line.replace('Fan:', '').trim();

                      return (
                        <div key={idx} className="flex gap-4">
                          <span
                            className={cn(
                              'w-20 font-black uppercase tracking-wider shrink-0 text-[10px]',
                              isAi ? 'text-[var(--m-accent)]' : 'text-[var(--m-muted)]'
                            )}
                          >
                            {speaker}:
                          </span>
                          <span className="text-[var(--m-text-2)] leading-relaxed">{text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
