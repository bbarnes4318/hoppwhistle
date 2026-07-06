'use client';

import { ArrowRight, Phone, Cpu, BarChart2, Shield, Radio } from 'lucide-react';

export function HeroSection() {
  const scrollToPreview = () => {
    const el = document.getElementById('dashboard-preview');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="relative overflow-hidden bg-[#070913] text-white pt-24 pb-20 md:pt-32 md:pb-28 lg:pt-40 lg:pb-36 border-b border-slate-900">
      {/* Background Gradients */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a50_1px,transparent_1px),linear-gradient(to_bottom,#0f172a50_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute left-1/3 top-1/4 w-[400px] h-[250px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="container max-w-7xl mx-auto px-6 md:px-8 relative">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto space-y-6 md:space-y-8">
          {/* Tagline Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs font-semibold text-emerald-400 backdrop-blur-md shadow-sm">
            <Radio className="h-3 w-3 animate-pulse" />
            <span>Introducing Hopwhistle Conductor AI</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1]">
            AI Voice and Call Tracking <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500">
              Built for Serious Operators.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="max-w-2xl text-base sm:text-lg md:text-xl text-slate-400 leading-relaxed font-normal">
            Hopwhistle helps teams launch AI voice campaigns, track every call, route traffic
            intelligently, manage buyers and publishers, analyze recordings, and operate phone-based
            revenue systems from one clean platform.
          </p>

          {/* Call to Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
            <a
              href="mailto:jimmy@leadzer.io"
              className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg bg-emerald-500 px-8 font-semibold text-slate-950 shadow-lg shadow-emerald-500/10 hover:bg-emerald-400 hover:shadow-emerald-400/20 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200"
            >
              Request Access
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <button
              onClick={scrollToPreview}
              className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/40 px-8 font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition-all duration-200"
            >
              View Platform
            </button>
          </div>
        </div>

        {/* Hero Product Mockup */}
        <div className="mt-16 md:mt-24 relative rounded-2xl border border-slate-800/80 bg-slate-950/60 p-2 md:p-3 shadow-2xl shadow-emerald-500/5 backdrop-blur-sm max-w-5xl mx-auto group">
          {/* Subtle Glow Border */}
          <div className="absolute -inset-px bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 rounded-2xl opacity-50 blur-[2px] pointer-events-none group-hover:opacity-75 transition-all"></div>

          <div className="relative rounded-xl border border-slate-800/80 bg-slate-950 overflow-hidden shadow-inner">
            {/* Mockup Titlebar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-800"></span>
                <span className="w-3 h-3 rounded-full bg-slate-800"></span>
                <span className="w-3 h-3 rounded-full bg-slate-800"></span>
              </div>
              <div className="flex items-center gap-2 rounded bg-slate-900 border border-slate-800 px-3 py-1 text-[11px] text-slate-500 font-mono w-44 md:w-60 justify-center">
                <span>app.hopwhistle.com/dashboard</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span>System Active</span>
              </div>
            </div>

            {/* Mockup Dashboard Grid */}
            <div className="p-4 md:p-6 space-y-6">
              {/* Row 1: KPI Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between text-slate-500 text-xs">
                    <span>Live Active Calls</span>
                    <Phone className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono">148</div>
                  <div className="mt-1 text-[10px] text-emerald-400 font-semibold">
                    98.2% Answer Rate
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between text-slate-500 text-xs">
                    <span>AI Voice Agents</span>
                    <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono">34</div>
                  <div className="mt-1 text-[10px] text-cyan-400 font-semibold">
                    12.4ms Avg Latency
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between text-slate-500 text-xs">
                    <span>Buyer Routing Yield</span>
                    <BarChart2 className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono">$18,490</div>
                  <div className="mt-1 text-[10px] text-blue-400 font-semibold">
                    +18.5% margin lift
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between text-slate-500 text-xs">
                    <span>Success Rate</span>
                    <Shield className="h-3.5 w-3.5 text-indigo-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono">99.98%</div>
                  <div className="mt-1 text-[10px] text-emerald-400 font-semibold">
                    No dropped calls
                  </div>
                </div>
              </div>

              {/* Row 2: Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Active AI Campaigns */}
                <div className="lg:col-span-2 rounded-xl border border-slate-800/80 bg-slate-900/20 p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <h3 className="text-sm font-semibold text-slate-200">
                      Active AI Voice Campaigns
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono">4 Total Runs</span>
                  </div>

                  <div className="space-y-3">
                    {/* Item 1 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-900/60 gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
                          <Cpu className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">Inbound Lead Qualifier</p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            Agent: V2-Smart-Prompt • DID: 1-800-421-2900
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400">82 live sessions</span>
                          <div className="w-16 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                            <div className="bg-emerald-500 h-full w-[70%]"></div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-semibold">
                          Active
                        </span>
                      </div>
                    </div>

                    {/* Item 2 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-900/60 gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 text-cyan-400">
                          <Cpu className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">Debt Relief Intake bot</p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            Agent: V3-Debt-Intake • DID: 1-888-902-1249
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400">41 live sessions</span>
                          <div className="w-16 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                            <div className="bg-cyan-500 h-full w-[45%]"></div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-semibold">
                          Active
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Routing Status */}
                <div className="rounded-xl border border-slate-800/80 bg-slate-900/20 p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
                      <h3 className="text-sm font-semibold text-slate-200">
                        Real-time Routing Paths
                      </h3>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-2 rounded bg-slate-900/50">
                        <span className="text-slate-400">Telnyx Trunk #1</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-slate-300 font-mono">IVR Engine</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-emerald-400 font-semibold">Buyer Tier 1</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded bg-slate-900/50">
                        <span className="text-slate-400">Twilio SIP #4</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-slate-300 font-mono">Voice AI Bot</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-cyan-400 font-semibold">Qualified Sales</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded bg-slate-900/50">
                        <span className="text-slate-400">Plivo DID Local</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-slate-300 font-mono">Direct Route</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-blue-400 font-semibold">Buyer Tier 3</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Active DIDs: 1,842</span>
                    <span>Hold Time: 1.4s</span>
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
