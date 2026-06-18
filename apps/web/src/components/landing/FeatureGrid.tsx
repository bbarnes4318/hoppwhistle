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
      title: 'Real-time Tracking',
      description:
        'Track every call back to the traffic source, ad group, or landing page. Know exactly which channels yield high-duration conversions.',
    },
    {
      icon: <PhoneIncoming className="h-5 w-5 text-cyan-400" />,
      title: 'Carrier Connectivity',
      description:
        'Direct integrations with Tier 1 carriers like Telnyx and Twilio. Provision, purchase, and deploy local or toll-free numbers instantly.',
    },
    {
      icon: <Sliders className="h-5 w-5 text-blue-400" />,
      title: 'Flow Builder',
      description:
        'Visual flow setup lets operators customize paths. Connect incoming callers to qualification bots, prompt IVRs, and routing agents.',
    },
    {
      icon: <Webhook className="h-5 w-5 text-indigo-400" />,
      title: 'Instant Webhooks',
      description:
        'Send call events, duration milestones, and buyer outcomes to downstream CRMs and lead platforms with sub-second latency.',
    },
    {
      icon: <ShieldAlert className="h-5 w-5 text-purple-400" />,
      title: 'Compliance & Protection',
      description:
        'Scrub calls against DNC lists, validate number state before dialing, and automatically block known robo-callers and spammers.',
    },
    {
      icon: <BadgeDollarSign className="h-5 w-5 text-rose-400" />,
      title: 'Ledgers & Payouts',
      description:
        'Manage publisher contract payouts, track buyer prepayments, set daily campaign caps, and enforce automatic budget cut-offs.',
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
            High-performance call capabilities.
          </h2>
          <p className="text-base sm:text-lg text-slate-400">
            A comprehensive suite of telecom tools built for performance marketers, AI agencies, and
            telecom operators.
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
