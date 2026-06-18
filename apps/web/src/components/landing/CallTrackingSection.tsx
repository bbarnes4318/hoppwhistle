'use client';

import { Check, ShieldCheck, MapPin, Clock, ArrowUpRight } from 'lucide-react';

export function CallTrackingSection() {
  return (
    <section
      id="routing"
      className="bg-white text-slate-900 py-24 border-b border-slate-100 relative"
    >
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Side: Mockup Card */}
          <div className="lg:col-span-6 order-last lg:order-first">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-6 shadow-xl relative">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
                <div>
                  <span className="text-[10px] text-slate-400 font-mono">CALL_ID: c_8f10ea4c</span>
                  <h3 className="text-sm font-bold text-slate-950 mt-0.5">Caller Intake Routing</h3>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
                  Route Completed
                </span>
              </div>

              {/* Call Attributes */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-xs border-b border-slate-200/60 pb-4">
                  <div>
                    <span className="text-slate-400 block mb-0.5">Caller Number</span>
                    <span className="font-mono text-slate-800 font-medium">+1 (281) 555-0193</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Traffic Source</span>
                    <span className="text-slate-800 font-medium">Google Ads • Search</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Geo Location</span>
                    <span className="text-slate-800 font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-400" /> Texas, US
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Wait Duration</span>
                    <span className="text-slate-800 font-medium flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" /> 1.2 seconds
                    </span>
                  </div>
                </div>

                {/* Routing Evaluation */}
                <div className="space-y-2.5">
                  <span className="text-[10px] text-slate-400 font-mono block">
                    ROUTING DECISIONS (PRIORITY MATCH)
                  </span>

                  {/* Tier 1 */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white text-xs opacity-60">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                      <span className="text-slate-500 font-medium">1. National Buyer Tier A</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      Cap Exceeded (150/150)
                    </span>
                  </div>

                  {/* Tier 2 */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/20 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="text-slate-800 font-semibold">2. Regional Buyer Tier B</span>
                    </div>
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100/50 px-2 py-0.5 rounded border border-emerald-200/50">
                      Matched ($24.50 Bid)
                    </span>
                  </div>
                </div>

                {/* Outcome Info */}
                <div className="rounded-lg bg-slate-900 text-white p-3 flex items-center justify-between text-xs mt-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Postback triggered (Google Offline Conv)</span>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Content */}
          <div className="lg:col-span-6 space-y-8">
            <div className="space-y-4">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Track every call from source to outcome.
              </h2>
              <p className="text-slate-500 text-base sm:text-lg leading-relaxed">
                Route calls to the right buyer, agent, or campaign in real time. Hopwhistle tracks
                routing hops, ring times, and buyer outcomes, allowing performance marketing
                networks to optimize call traffic instantly.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                'Dynamic Number Insertion (DNI) mapping site visits to phone calls',
                'Real-time bidding (RTB) engine allocating calls to highest-paying buyers',
                'Custom business hours, concurrency limitations, and buyer pause states',
                'Google Ads, Facebook, and Redtrack offline conversion integration',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3 text-sm text-slate-600">
                  <div className="h-5 w-5 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0 text-emerald-600 mt-0.5">
                    <Check className="h-3 w-3" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
