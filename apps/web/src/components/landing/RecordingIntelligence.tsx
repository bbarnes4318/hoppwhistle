'use client';

import { Check, BrainCircuit, Headphones, FileText, Smile } from 'lucide-react';

export function RecordingIntelligence() {
  return (
    <section className="bg-[#0B0F19] text-white py-24 border-b border-slate-900 relative">
      <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Side: Content */}
          <div className="lg:col-span-6 space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
                <BrainCircuit className="h-3.5 w-3.5" />
                <span>AI Transcript Analysis</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                Turn recordings into usable business intelligence.
              </h2>
              <p className="text-slate-400 text-base sm:text-lg leading-relaxed">
                Analyze call records instantly using specialized LLM filters. Identify buyer dispute
                trends, detect agent script adherence, and audit compliance requirements without
                manually listening to hours of raw audio.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                'Whisper-powered transcription mapping split-channel stereo audio',
                'Milestone sentiment analysis tracking caller intent transitions',
                'Automated QA scorecards measuring disclosures and script compliance',
                'Semantic search to instantly find disputable claims across all campaigns',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3 text-sm text-slate-300">
                  <div className="h-5 w-5 rounded-full bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center flex-shrink-0 text-cyan-400 mt-0.5">
                    <Check className="h-3 w-3" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right Side: Mockup */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 md:p-6 shadow-2xl relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <Headphones className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-200">Recording Analyzer</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] bg-slate-900 px-2 py-0.5 rounded text-slate-400 border border-slate-800">
                  <span>ID: rec_09d2ef1</span>
                </div>
              </div>

              {/* Waveform Mockup */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-3.5 mb-4 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Stereo Recording Track</span>
                  <span>03:14 / 05:42</span>
                </div>
                {/* Visual Audio Bars */}
                <div className="flex items-end justify-between h-8 gap-0.5 pt-2">
                  {[
                    2, 4, 3, 5, 8, 4, 2, 3, 6, 7, 5, 3, 4, 7, 9, 8, 5, 3, 4, 6, 5, 8, 4, 2, 5, 7, 6,
                    3, 4, 2, 4, 7, 9, 8, 4, 2,
                  ].map((val, idx) => (
                    <div
                      key={idx}
                      className="bg-cyan-500/40 rounded-sm w-full transition-all hover:bg-cyan-400"
                      style={{ height: `${val * 10}%` }}
                    ></div>
                  ))}
                </div>
              </div>

              {/* Transcript Bubbles */}
              <div className="space-y-3 mb-4 max-h-[160px] overflow-y-auto">
                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[10px] font-bold text-cyan-400 flex-shrink-0">
                    C
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs">
                    <p className="text-slate-400 font-semibold mb-0.5">Caller (01:12)</p>
                    <p className="text-slate-300">
                      Yes, I am looking to enroll in the consolidation program today. I have around
                      twelve thousand in debt.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-400 flex-shrink-0">
                    A
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs">
                    <p className="text-slate-400 font-semibold mb-0.5">
                      AI Agent / Conductor (01:21)
                    </p>
                    <p className="text-slate-300">
                      Got it. Let me verify your zip code first so I can matching you with the
                      correct local representative.
                    </p>
                  </div>
                </div>
              </div>

              {/* QA Checklist */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3.5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Automated QA Checklist
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    <Smile className="h-3 w-3" />
                    <span>88/100 Sentiment Score</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] font-medium text-slate-300">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    <span>Consent to record stated</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    <span>Debt amount verified (&gt; $10k)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    <span>State licensing matching</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    <span>TCPA Disclosure read</span>
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
