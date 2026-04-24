'use client';

import {
  Activity,
  BarChart3,
  Check,
  CheckCircle2,
  Disc3,
  FileText,
  Lock,
  Mic,
  Play,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  Users,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';

export default function MusicLandingPage() {
  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 selection:bg-violet-500/30 font-sans overflow-x-hidden">
      
      {/* ─── Ambient Glow ─── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[800px] h-[800px] rounded-full bg-violet-600/5 blur-[150px]" />
        <div className="absolute top-[40%] right-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-600/5 blur-[120px]" />
      </div>

      {/* ─── Navigation ─── */}
      <nav className="relative z-50 flex items-center justify-between px-6 py-5 md:px-12 border-b border-white/[0.04] bg-[#060608]/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Disc3 className="h-6 w-6 text-zinc-100" />
          <span className="text-base font-bold tracking-tight">
            Hopwhistle <span className="text-violet-400">Music</span>
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-xs font-medium text-zinc-400 hover:text-zinc-100 transition-colors">
            Sign In
          </Link>
          <Link 
            href="/music-console" 
            className="rounded bg-white px-4 py-2 text-xs font-bold text-black transition-transform hover:scale-105 active:scale-95"
          >
            Launch Console
          </Link>
        </div>
      </nav>

      <main className="relative z-10 flex flex-col items-center">
        
        {/* ─── 1. Hero Section ─── */}
        <section className="w-full max-w-6xl px-6 pt-32 pb-24 md:pt-40 md:pb-32 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 mb-8">
            <Volume2 className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-semibold tracking-wider text-violet-300 uppercase">
              AI-Powered Direct-to-Fan Voice
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.05] max-w-5xl">
            Activate Your Superfans <br className="hidden md:block" />
            <span className="text-zinc-500">with AI Voice.</span>
          </h1>
          
          <p className="mt-8 text-lg md:text-xl text-zinc-400 max-w-3xl leading-relaxed">
            Launch direct-to-fan voice campaigns that drive pre-saves, ticket intent, merch demand, and verified fan engagement — with recordings, transcripts, and real-time proof of every interaction.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row items-center gap-4">
            <button className="flex items-center gap-2 rounded bg-violet-600 px-8 py-4 text-sm font-bold text-white transition-all hover:bg-violet-500 active:scale-95">
              <Play className="h-4 w-4 fill-current" />
              Hear the Fan Agent
            </button>
            <Link 
              href="/music-console" 
              className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-8 py-4 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95"
            >
              View Music Dashboard
            </Link>
          </div>

          <p className="mt-10 text-[11px] font-medium tracking-widest text-zinc-600 uppercase">
            Built for labels, managers, promoters, venues, and fan engagement teams.
          </p>

          {/* Hero Proof Strip */}
          <div className="mt-20 w-full border-y border-white/[0.04] bg-white/[0.01] py-6 overflow-hidden">
            <div className="flex flex-wrap justify-center gap-8 md:gap-16 text-[13px] font-medium text-zinc-500">
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-zinc-700" /> Pre-Saves</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-zinc-700" /> Ticket Intent</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-zinc-700" /> Verified Fan Engagement</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-zinc-700" /> Transcript Proof</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-zinc-700" /> Real-Time Stats</span>
            </div>
          </div>
        </section>

        {/* ─── 2. The Problem ─── */}
        <section className="w-full max-w-5xl px-6 py-24 md:py-32 grid md:grid-cols-2 gap-16 items-center border-t border-white/[0.04]">
          <div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-100">
              Your fans are real. Your engagement data should be too.
            </h2>
          </div>
          <div>
            <p className="text-lg text-zinc-400 leading-relaxed mb-4">
              This is not another dashboard for clicks. This is direct fan activation with verified proof.
            </p>
            <p className="text-lg text-zinc-400 leading-relaxed">
              Know which fans actually responded. Give labels and managers proof, not estimates.
            </p>
          </div>
        </section>

        {/* ─── 3. The Solution & 4. How It Works ─── */}
        <section className="w-full bg-zinc-950 border-y border-white/[0.04] py-24 md:py-32">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-100">
                Talk to fans directly.<br />Verify every interaction.
              </h2>
              <p className="mt-6 text-lg text-zinc-400">
                Opted-in fan campaigns use artist-approved outreach to drive pre-saves, ticket intent, and merch demand. Turn fan conversations into campaign data and prove engagement with recordings and transcripts.
              </p>
            </div>

            <div className="grid md:grid-cols-5 gap-8">
              {[
                { step: '01', title: 'Upload Audience', desc: 'Import opted-in fan lists from your CRM.' },
                { step: '02', title: 'Select Goal', desc: 'Choose pre-saves, tickets, merch, or feedback.' },
                { step: '03', title: 'Approve Script', desc: 'Review artist-safe conversational flows.' },
                { step: '04', title: 'Launch Outreach', desc: 'AI agent dials and speaks with fans at scale.' },
                { step: '05', title: 'Track Proof', desc: 'Monitor intent, transcripts, and real-time stats.' },
              ].map((item) => (
                <div key={item.step} className="relative p-6 border border-white/[0.05] rounded bg-white/[0.02]">
                  <span className="text-[10px] font-mono text-violet-500 mb-4 block">{item.step}</span>
                  <h3 className="text-sm font-bold text-zinc-200 mb-2">{item.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 5. Use Cases ─── */}
        <section className="w-full max-w-6xl px-6 py-24 md:py-32">
          <div className="mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Campaign Types</h2>
            <p className="mt-4 text-zinc-400">Deploy purpose-built AI agents for every phase of the artist lifecycle.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Mic, title: 'Album Pre-Save Campaigns' },
              { icon: Ticket, title: 'Tour On-Sale Alerts' },
              { icon: Users, title: 'VIP Upgrades' },
              { icon: ShoppingBag, title: 'Merch Drops' },
              { icon: Activity, title: 'Fan Club Reactivation' },
              { icon: BarChart3, title: 'Festival Promotion' },
            ].map((uc) => (
              <div key={uc.title} className="flex items-center gap-4 p-5 rounded border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-colors">
                <div className="h-10 w-10 rounded bg-white/[0.04] flex items-center justify-center">
                  <uc.icon className="h-4 w-4 text-zinc-400" />
                </div>
                <span className="text-sm font-semibold text-zinc-200">{uc.title}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── 6. Dashboard Preview ─── */}
        <section className="w-full bg-[#0a0a0c] border-y border-white/[0.04] py-24 md:py-32 overflow-hidden">
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-100 mb-12 text-center">Executive Visibility</h2>
            
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {[
                { title: 'Fans Contacted', value: '12.4K', color: 'text-zinc-100' },
                { title: 'Engagement Rate', value: '64.2%', color: 'text-violet-400' },
                { title: 'Cost per Pre-Save', value: '$1.10', color: 'text-zinc-100' },
                { title: 'Verified Actions', value: '4,892', color: 'text-cyan-400' },
                { title: 'Proof Captured', value: '100%', color: 'text-zinc-100' },
              ].map((kpi) => (
                <div key={kpi.title} className="p-5 rounded border border-white/[0.05] bg-black/50 backdrop-blur">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">{kpi.title}</p>
                  <p className={`text-2xl font-mono font-medium ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* Fake Chart / UI Element */}
            <div className="mt-8 w-full h-48 rounded border border-white/[0.05] bg-gradient-to-b from-white/[0.02] to-transparent flex items-end justify-between px-8 pt-8 pb-0">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="w-full mx-1 bg-violet-500/20 rounded-t" style={{ height: `${Math.random() * 80 + 20}%` }}>
                  <div className="w-full bg-cyan-400/40 rounded-t" style={{ height: `${Math.random() * 50}%` }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 7. Proof Layer & 8. Brand Safety ─── */}
        <section className="w-full max-w-6xl px-6 py-24 md:py-32 grid md:grid-cols-2 gap-20">
          
          {/* Proof Layer */}
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Every fan response becomes proof.</h2>
              <p className="mt-4 text-zinc-400">Zero ambiguity. You own the data, the recordings, and the outcomes.</p>
            </div>

            {/* Mock Transcript Card */}
            <div className="rounded border border-white/[0.08] bg-black p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500" />
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-xs font-bold text-zinc-200">Sarah M. • Los Angeles, CA</p>
                  <p className="text-[10px] text-zinc-500 font-mono mt-1">2026-04-24 14:32:01 UTC</p>
                </div>
                <span className="rounded bg-cyan-500/10 text-cyan-400 px-2 py-1 text-[9px] font-bold uppercase tracking-wider">Pre-Saved</span>
              </div>
              
              <div className="space-y-3 text-xs font-mono">
                <div className="flex gap-3">
                  <span className="text-violet-400">AI</span>
                  <span className="text-zinc-300 leading-relaxed">Nova Eclipse&apos;s new album drops Friday. Want me to set up a pre-save on Spotify for you?</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-zinc-500">FAN</span>
                  <span className="text-zinc-400 leading-relaxed">Yes! I&apos;ve been waiting for this. Pre-save me right now.</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-white/[0.04] flex items-center gap-4 text-[10px] text-zinc-500 font-medium">
                <span className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Transcript</span>
                <span className="flex items-center gap-1.5"><Volume2 className="h-3 w-3" /> Recording</span>
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-emerald-500/70" /> TCPA Compliant</span>
              </div>
            </div>
          </div>

          {/* Brand Safety */}
          <div className="space-y-8 flex flex-col justify-center">
            <div>
              <div className="inline-flex items-center justify-center h-12 w-12 rounded border border-white/[0.08] bg-white/[0.02] mb-6">
                <Lock className="h-5 w-5 text-zinc-300" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Artist-safe by design.</h2>
              <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                Your reputation is paramount. Campaigns use strictly approved scripts, bounded AI behavior, mandatory opt-in lists, immediate opt-out handling, and human-reviewable transcripts. The AI never goes off-script.
              </p>
            </div>
            <ul className="space-y-3 text-sm font-medium text-zinc-300">
              <li className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-400" /> Pre-approved dialogue trees</li>
              <li className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-400" /> Strict DNC (Do Not Call) adherence</li>
              <li className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-400" /> Instant conversational boundaries</li>
            </ul>
          </div>

        </section>

        {/* ─── 9. Final CTA ─── */}
        <section className="w-full border-t border-white/[0.04] bg-gradient-to-b from-transparent to-violet-950/20 py-32 text-center px-6">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-100 max-w-2xl mx-auto">
            Make your next rollout measurable.
          </h2>
          <p className="mt-6 text-lg text-zinc-400 max-w-2xl mx-auto">
            Run artist-safe voice campaigns that turn fan attention into verified action.
          </p>
          <div className="mt-10 flex justify-center">
            <button className="flex items-center gap-2 rounded bg-white px-8 py-4 text-sm font-bold text-black transition-transform hover:scale-105 active:scale-95">
              <Play className="h-4 w-4 fill-current" />
              Hear the Fan Agent
            </button>
          </div>
        </section>

      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-white/[0.04] bg-[#060608] px-6 py-8 md:px-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Disc3 className="h-4 w-4 text-zinc-500" />
            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
              Hopwhistle Music © {new Date().getFullYear()}
            </span>
          </div>
          <div className="flex items-center gap-6 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
            <Link href="/legal/terms" className="hover:text-zinc-300 transition-colors">Terms</Link>
            <Link href="/legal/privacy" className="hover:text-zinc-300 transition-colors">Privacy</Link>
            <Link href="/music-console" className="hover:text-zinc-300 transition-colors">Console Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
