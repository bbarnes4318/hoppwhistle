'use client';

import { Megaphone, MessageSquareText, ShieldAlert, Radio } from 'lucide-react';

export function UseCases() {
  const cases = [
    {
      icon: <Megaphone className="h-6 w-6 text-emerald-600" />,
      title: 'Performance Marketers',
      description:
        'Acquire local and toll-free numbers, set up campaigns, route calls dynamically based on buyer capacity and bidding price, and optimize landing pages.',
    },
    {
      icon: <MessageSquareText className="h-6 w-6 text-cyan-600" />,
      title: 'AI Voice Agencies',
      description:
        'Deploy context-aware conversational bots to screen callers, gather pre-qualification criteria, and route transfer requests directly to client agents.',
    },
    {
      icon: <ShieldAlert className="h-6 w-6 text-blue-600" />,
      title: 'Lead Gen Networks',
      description:
        'Validate caller data in real-time, audit recordings using Whisper transcription and LLM criteria, and provide clear reporting to publisher sources.',
    },
    {
      icon: <Radio className="h-6 w-6 text-indigo-600" />,
      title: 'Telecom Operators',
      description:
        'Connect existing SIP infrastructure or carriers directly, purchase thousands of numbers in bulk, and run high-concurrency outbound operations.',
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
            Engineered for high-volume call teams.
          </h2>
          <p className="text-base sm:text-lg text-slate-500 max-w-2xl mx-auto">
            Whether routing calls to external buyer networks or training conversational AI agents,
            Hopwhistle provides the infrastructure operators trust.
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
