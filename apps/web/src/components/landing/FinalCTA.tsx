'use client';

import { ArrowRight, Radio } from 'lucide-react';
import Link from 'next/link';

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-[#070913] text-white py-24 md:py-32 border-b border-slate-900">
      {/* Background Gradients */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a30_1px,transparent_1px),linear-gradient(to_bottom,#0f172a30_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="container max-w-5xl mx-auto px-6 md:px-8 relative text-center space-y-8 md:space-y-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs font-semibold text-emerald-400 backdrop-blur-md">
          <Radio className="h-3 w-3 animate-pulse" />
          <span>Operator Console v1.2</span>
        </div>

        <div className="max-w-3xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Ready to upgrade your call operations?
          </h2>
          <p className="text-slate-400 text-base sm:text-lg max-w-2xl mx-auto">
            Get the routing reliability, recording audits, and voice agent configurations required
            for large-scale telephony campaigns.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
          <a
            href="mailto:jimmy@leadzer.io"
            className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg bg-emerald-500 px-8 font-semibold text-slate-950 shadow-lg shadow-emerald-500/10 hover:bg-emerald-400 hover:shadow-emerald-400/20 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200"
          >
            Request Access
            <ArrowRight className="ml-2 h-4 w-4" />
          </a>
          <Link
            href="/login"
            className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/40 px-8 font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition-all duration-200"
          >
            Sign In to Platform
          </Link>
        </div>
      </div>
    </section>
  );
}
