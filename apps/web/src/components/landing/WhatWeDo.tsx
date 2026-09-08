'use client';

import { Cpu, Shuffle, Layers } from 'lucide-react';

export function WhatWeDo() {
  const cards = [
    {
      icon: <Cpu className="h-6 w-6 text-emerald-500" />,
      title: 'Calls, already qualified',
      description:
        'Callers are screened before they reach you. Your agents pick up people who asked to be called about a plan, in a state you are licensed for, inside the hours you set.',
    },
    {
      icon: <Shuffle className="h-6 w-6 text-cyan-500" />,
      title: 'Delivery you control',
      description:
        'Set a daily block of applications and a ceiling above it. Delivery pauses when the block is used, and the applications you have already paid for stay available when it resumes.',
    },
    {
      icon: <Layers className="h-6 w-6 text-blue-500" />,
      title: 'Settlement you can audit',
      description:
        'Every application is priced against the rate in force at the time, listed line by line, and reconciled against your Insertion Order. You can export the whole ledger.',
    },
  ];

  return (
    <section className="bg-white text-slate-900 py-24 border-b border-slate-100">
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16 md:mb-20">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            An agency portal, not a dialer.
          </h2>
          <p className="text-base sm:text-lg text-slate-500 max-w-2xl mx-auto font-normal">
            You are not buying software to run yourself. You are buying delivered calls, and this
            is where you watch them arrive, see what your agents did with them, and check the
            arithmetic before you pay.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {cards.map((card, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200/80 bg-slate-50 p-6 md:p-8 space-y-6 hover:shadow-lg hover:shadow-slate-200/50 hover:border-slate-300 transition-all duration-300 group"
            >
              <div className="h-12 w-12 rounded-lg bg-white border border-slate-200/60 shadow-sm flex items-center justify-center transition-transform group-hover:scale-105">
                {card.icon}
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-slate-900">{card.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
