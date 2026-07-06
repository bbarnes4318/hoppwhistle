'use client';

import { Activity, PhoneCall, TrendingUp, Sparkles } from 'lucide-react';

export function DashboardPreview() {
  return (
    <section
      id="dashboard-preview"
      className="bg-[#070913] text-white py-24 border-b border-slate-900 relative"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1e293b15_0%,transparent_80%)] pointer-events-none"></div>

      <div className="container max-w-7xl mx-auto px-6 md:px-8 relative">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Immersive Dashboard Experience</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Complete operational visibility.
          </h2>
          <p className="text-base sm:text-lg text-slate-400">
            Manage numbers, adjust IVR trees, inspect transcriptions, and audit campaigns from a
            unified operator console.
          </p>
        </div>

        {/* Immersive Dashboard Preview Card */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/10 p-3 md:p-4 shadow-2xl backdrop-blur-md max-w-5xl mx-auto">
          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950">
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold text-white tracking-tight">
                  Hopwhistle Analytics
                </span>
                <span className="h-4 w-px bg-slate-800"></span>
                <span className="text-xs text-slate-400">Real-time Overview</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-mono">TZ: EST (New York)</span>
              </div>
            </div>

            {/* Dashboard Content */}
            <div className="p-6 space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 block">Total Call Revenue</span>
                    <span className="text-2xl font-bold font-mono mt-1 block">$148,920.00</span>
                  </div>
                  <TrendingUp className="h-8 w-8 text-emerald-400/80 bg-emerald-500/5 p-1.5 rounded-lg border border-emerald-500/10" />
                </div>

                <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 block">Call Concurrency</span>
                    <span className="text-2xl font-bold font-mono mt-1 block">42 / 500 Max</span>
                  </div>
                  <Activity className="h-8 w-8 text-cyan-400/80 bg-cyan-500/5 p-1.5 rounded-lg border border-cyan-500/10" />
                </div>

                <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 block">Active SIP Trunks</span>
                    <span className="text-2xl font-bold font-mono mt-1 block">6 Active</span>
                  </div>
                  <PhoneCall className="h-8 w-8 text-blue-400/80 bg-blue-500/5 p-1.5 rounded-lg border border-blue-500/10" />
                </div>
              </div>

              {/* Chart & Map Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Volume Area Chart (SVG) */}
                <div className="lg:col-span-7 bg-slate-900/20 border border-slate-800/80 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Call Volume History (24h)
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      1,249 calls processed
                    </span>
                  </div>

                  {/* SVG Chart */}
                  <div className="h-44 w-full relative">
                    <svg className="w-full h-full" viewBox="0 0 100 30" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {/* Area */}
                      <path
                        d="M 0 30 L 0 22 Q 10 12 20 20 T 40 8 T 60 14 T 80 5 T 100 12 L 100 30 Z"
                        fill="url(#chart-grad)"
                      />
                      {/* Line */}
                      <path
                        d="M 0 22 Q 10 12 20 20 T 40 8 T 60 14 T 80 5 T 100 12"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="0.8"
                      />
                      {/* Target threshold line */}
                      <line
                        x1="0"
                        y1="18"
                        x2="100"
                        y2="18"
                        stroke="#1e293b"
                        strokeWidth="0.4"
                        strokeDasharray="1 1"
                      />
                    </svg>

                    {/* Tooltip Hover Overlay */}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[9px] text-slate-300 font-mono shadow-md">
                      <span className="text-emerald-400 font-bold">140 calls</span> at 04:00 PM
                    </div>
                  </div>

                  <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                    <span>12:00 AM</span>
                    <span>06:00 AM</span>
                    <span>12:00 PM</span>
                    <span>06:00 PM</span>
                    <span>11:00 PM</span>
                  </div>
                </div>

                {/* Geographical distribution map mockup */}
                <div className="lg:col-span-5 bg-slate-900/20 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                      <span className="text-xs font-semibold text-slate-200">
                        Call Origination Heat
                      </span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>

                    {/* Styled geographic point grid */}
                    <div className="relative h-28 bg-slate-950 border border-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b20_1px,transparent_1px),linear-gradient(to_bottom,#1e293b20_1px,transparent_1px)] bg-[size:10px_10px]"></div>

                      {/* Mock hot spots */}
                      <span className="absolute top-1/4 left-1/4 w-3 h-3 bg-emerald-400 rounded-full blur-[2px] animate-pulse"></span>
                      <span className="absolute top-1/2 left-2/3 w-4.5 h-4.5 bg-cyan-400 rounded-full blur-[3px] animate-pulse"></span>
                      <span className="absolute bottom-1/3 left-1/3 w-2 h-2 bg-blue-500 rounded-full blur-[1px] animate-pulse"></span>
                      <span className="text-[10px] text-slate-600 font-mono tracking-widest uppercase pointer-events-none">
                        US Carrier Origination
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-[10px] text-slate-400 font-mono mt-4">
                    <div className="flex justify-between">
                      <span>Texas (DFW-1)</span>
                      <span className="text-slate-300 font-bold">54 active</span>
                    </div>
                    <div className="flex justify-between">
                      <span>California (LAX-3)</span>
                      <span className="text-slate-300 font-bold">38 active</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
