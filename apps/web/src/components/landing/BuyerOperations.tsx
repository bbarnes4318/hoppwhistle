'use client';

import { Check, Users, Scale } from 'lucide-react';

export function BuyerOperations() {
  return (
    <section className="bg-white text-slate-900 py-24 border-b border-slate-100 relative">
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Side: Mockup Grid */}
          <div className="lg:col-span-6 order-last lg:order-first">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-6 shadow-xl space-y-6">
              {/* Publisher Ledger */}
              <div className="space-y-2.5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                  PUBLISHER_TRAFFIC_LEDGER
                </span>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-normal">
                        <th className="pb-2">Source / Partner</th>
                        <th className="pb-2 text-right">Inbound Calls</th>
                        <th className="pb-2 text-right">Qualified (90s+)</th>
                        <th className="pb-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      <tr>
                        <td className="py-2.5 font-medium text-slate-900">LeadWave Media</td>
                        <td className="py-2.5 text-right font-mono">1,842</td>
                        <td className="py-2.5 text-right font-mono">1,204</td>
                        <td className="py-2.5 text-right font-mono text-slate-900 font-semibold">
                          $29,498
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-medium text-slate-900">SearchFlow Ads</td>
                        <td className="py-2.5 text-right font-mono">924</td>
                        <td className="py-2.5 text-right font-mono">682</td>
                        <td className="py-2.5 text-right font-mono text-slate-900 font-semibold font-medium">
                          $16,709
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Buyer Allocation Controls */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Scale className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-bold text-slate-900">Active Buyer Contract</span>
                  </div>
                  <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-100 font-semibold">
                    Priority 1 Match
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block mb-0.5">Buyer Entity</span>
                    <span className="text-slate-800 font-semibold">Apex Health Group</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Call Target Price</span>
                    <span className="text-slate-800 font-mono font-semibold">
                      $48.00 / connection
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Concurrency Cap</span>
                    <span className="text-slate-800 font-semibold">25 active calls</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Dial State Filters</span>
                    <span className="text-slate-800 font-semibold">CA, TX, FL, NY</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Content */}
          <div className="lg:col-span-6 space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                <Users className="h-3.5 w-3.5" />
                <span>Multi-Tenant Operations</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Give operators, buyers, and publishers the visibility they need.
              </h2>
              <p className="text-slate-500 text-base sm:text-lg leading-relaxed">
                Hopwhistle balances caller traffic streams automatically. Provide publishers with
                dedicated reporting dashboards to trace their leads, and give buyers access to
                real-time portals to pause lines, adjust bid criteria, and check state routing
                targets.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                'Separate, secure dashboard interfaces for publishers and buyers',
                'Custom payout rules based on raw clicks, call connect, or duration milestones',
                'Real-time bid adjustments with automatic caps to prevent financial overrun',
                'Transparent transaction ledger logging buyer claims and publisher splits',
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
