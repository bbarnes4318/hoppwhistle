'use client';

import { Play, Check, Cpu, Sparkles, MessageSquare } from 'lucide-react';

export function AIVoiceSection() {
  return (
    <section
      id="ai-voice"
      className="bg-[#070913] text-white py-24 border-b border-slate-900 relative"
    >
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[350px] h-[350px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Side: Content */}
          <div className="lg:col-span-6 space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Conversational Agent Engine</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                Launch AI voice campaigns without losing control of the call flow.
              </h2>
              <p className="text-slate-400 text-base sm:text-lg leading-relaxed">
                Deploy human-like conversational agents trained on your specific qualification
                scripts. Collect client data, verify budget constraints, and execute hot transfers
                to live operators only when qualification criteria are met.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                'High-fidelity speech synthesis and low-latency response engine',
                'Dynamic prompt trees that adapt based on prospect answers',
                'Live transfer nodes with state preservation (agent gets full AI summary)',
                'Automated QA checklists running instantly on call termination',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3 text-sm text-slate-300">
                  <div className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 text-emerald-400 mt-0.5">
                    <Check className="h-3 w-3" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right Side: Flow Mockup */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950 p-4 md:p-6 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl"></div>

              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    CONDUCTOR_FLOW_BUILDER
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">v1.2 Active</span>
              </div>

              {/* Mockup Canvas */}
              <div className="space-y-6 relative">
                {/* Node 1 */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 flex items-center justify-between relative">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">1. Trigger: Inbound Call</p>
                      <p className="text-[10px] text-slate-500">
                        DID matched to Campaign ID: `c_debt_relief`
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] text-slate-400 font-mono">Twilio SIP</span>
                  <div className="absolute left-1/2 -bottom-6 w-px h-6 bg-slate-800"></div>
                </div>

                {/* Node 2 */}
                <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 space-y-3 relative">
                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                      <p className="text-xs font-bold text-slate-200">
                        2. AI Agent Node: Qualifier
                      </p>
                    </div>
                    <span className="text-[9px] bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded text-cyan-400 font-semibold">
                      Active
                    </span>
                  </div>

                  <div className="space-y-1.5 font-mono text-[10px]">
                    <p className="text-slate-400">
                      <span className="text-slate-600">Prompt:</span> &quot;Hi there! I see you are
                      inquiring about debt relief. Are you looking to consolidate more than
                      $10,000?&quot;
                    </p>
                    <div className="flex gap-2 pt-1">
                      <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        Branch: Yes
                      </span>
                      <span className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        Branch: No
                      </span>
                    </div>
                  </div>
                  <div className="absolute left-1/2 -bottom-6 w-px h-6 bg-slate-800"></div>
                </div>

                {/* Node 3 */}
                <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 flex items-center justify-between relative">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">3. Decision: Route Call</p>
                      <p className="text-[10px] text-slate-500">
                        Matches criteria (Budget &gt; $10k)
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] text-emerald-400 font-semibold font-mono">
                    Passed
                  </span>
                  <div className="absolute left-1/2 -bottom-6 w-px h-6 bg-slate-800"></div>
                </div>

                {/* Node 4 */}
                <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <Play className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-emerald-400">
                        4. SIP Transfer: Tier 1 Buyer
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Injecting transcript summary to agent console
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-bold font-mono">
                    18ms Transfer
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
