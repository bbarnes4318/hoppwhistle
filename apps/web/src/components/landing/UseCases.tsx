'use client';

import { Megaphone, MessageSquareText, ShieldAlert, Radio } from 'lucide-react';

export function UseCases() {
  const cases = [
    {
      icon: <Megaphone className="h-6 w-6 text-emerald-600" />,
      title: 'Health insurance agencies',
      description:
        'Take enrolment calls during open enrolment without hiring for the peak. Set the daily block to what your licensed agents can genuinely work, and raise it when they can take more.',
    },
    {
      icon: <MessageSquareText className="h-6 w-6 text-cyan-600" />,
      title: 'Medicare and ACA teams',
      description:
        'Callers arrive screened for state, age band and eligibility, with consent captured. Your agents spend the call on the application rather than on qualifying.',
    },
    {
      icon: <ShieldAlert className="h-6 w-6 text-blue-600" />,
      title: 'Agencies that have been burned',
      description:
        'If shared lead lists have not worked for you, this is the opposite arrangement: you pay for a submitted application, and every one of them has a recording behind it.',
    },
    {
      icon: <Radio className="h-6 w-6 text-indigo-600" />,
      title: 'Multi-office agencies',
      description:
        'Run several offices under one agency with per-agent reporting, or keep them as separate agencies with their own blocks and their own settlements.',
    },
  ];

  return (
    <section
      id="use-cases"
      className="bg-white text-slate-900 py-24 border-b border-slate-100 relative"
    >
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16 md:mb-20">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Who this is for.
          </h2>
          <p className="text-base sm:text-lg text-slate-500 max-w-2xl mx-auto">
            Agencies that write applications and would rather buy the call than build the machinery
            that produces it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {cases.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-6 space-y-5 hover:shadow-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-300 group"
            >
              <div className="h-12 w-12 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center transition-transform group-hover:scale-105">
                {item.icon}
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
