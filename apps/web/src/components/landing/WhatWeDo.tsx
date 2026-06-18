'use client';

import { Cpu, Shuffle, Layers } from 'lucide-react';

export function WhatWeDo() {
  const cards = [
    {
      icon: <Cpu className="h-6 w-6 text-emerald-500" />,
      title: 'AI Voice Campaigns',
      description:
        'Launch voice agents that handle inbound qualification, automated surveys, or lead intake, keeping full control of live transfer variables and transfer nodes.',
    },
    {
      icon: <Shuffle className="h-6 w-6 text-cyan-500" />,
      title: 'Intelligent Routing',
      description:
        'Route calls instantly to buyers, local agents, or downstream queues based on real-time bid pricing, capacity limits, caller context, and geographic rules.',
    },
    {
      icon: <Layers className="h-6 w-6 text-blue-500" />,
      title: 'Operations & Analytics',
      description:
        'Track every caller source, monitor bid spreads, inspect call recordings with transcription AI, and manage billing ledgers in a clean interface.',
    },
  ];

  return (
    <section className="bg-white text-slate-900 py-24 border-b border-slate-100">
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16 md:mb-20">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Everything you need to run high-volume phone operations.
          </h2>
          <p className="text-base sm:text-lg text-slate-500 max-w-2xl mx-auto font-normal">
            Hopwhistle replaces fragmented systems with a unified platform. Manage voice campaigns,
            buyers, publishers, routing tables, and real-time tracking under a single, highly
            performant stack.
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
