'use client';

import {
  Activity,
  PhoneIncoming,
  Sliders,
  Webhook,
  ShieldAlert,
  BadgeDollarSign,
} from 'lucide-react';

export function FeatureGrid() {
  const features = [
    {
      icon: <Activity className="h-5 w-5 text-emerald-400" />,
      title: 'Live delivery',
      description:
        'See calls arriving as they arrive, which agent took each one, and how many applications today has produced against the block you paid for.',
    },
    {
      icon: <PhoneIncoming className="h-5 w-5 text-cyan-400" />,
      title: 'Nothing to install',
      description:
        'Your agents take calls in the browser. There is no handset to buy, no client to deploy, and no telephony for your team to administer.',
    },
    {
      icon: <Sliders className="h-5 w-5 text-blue-400" />,
      title: 'Your qualification, applied',
      description:
        'Tell us the states, the age bands and the disqualifiers that matter to your agency. Callers who do not meet them do not reach your agents.',
    },
    {
      icon: <Webhook className="h-5 w-5 text-indigo-400" />,
      title: 'Applications where you work',
      description:
        'Submitted applications and their call recordings are posted to your CRM as they happen, so your team does not have to re-key anything.',
    },
    {
      icon: <ShieldAlert className="h-5 w-5 text-purple-400" />,
      title: 'Consent on the record',
      description:
        'Every caller reaches you with a consent record and a recording attached. Do-not-call and state licensing checks run before the call is routed.',
    },
    {
      icon: <BadgeDollarSign className="h-5 w-5 text-rose-400" />,
      title: 'Caps that hold',
      description:
        'A daily block, a ceiling above it, and a maximum daily debit on your Insertion Order. If a settlement would exceed it, no payment is taken and we are alerted.',
    },
  ];

  return (
    <section
      id="features"
      className="bg-[#0B0F19] text-white py-24 border-b border-slate-900 relative"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,#1e293b20_0%,transparent_70%)] pointer-events-none"></div>
      <div className="container max-w-7xl mx-auto px-6 md:px-8 relative">
        <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            What your agency actually gets.
          </h2>
          <p className="text-base sm:text-lg text-slate-400">
            Delivered calls, a portal to watch them in, and a settlement you can check line by
            line.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-6 space-y-4 hover:border-slate-700/60 hover:bg-slate-900/40 hover:shadow-lg transition-all duration-300 group"
            >
              <div className="h-10 w-10 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center group-hover:border-slate-700 transition-colors">
                {feature.icon}
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-slate-100">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
