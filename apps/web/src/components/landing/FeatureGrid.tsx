import { Server, PhoneCall, BrainCircuit, Activity } from 'lucide-react';

export function FeatureGrid() {
  const features = [
    {
      icon: <Server className="h-6 w-6 text-primary" />,
      title: 'SIP & Infrastructure',
      description:
        'Direct SIP trunking, infinite concurrent channels, and sub-millisecond local routing on bare metal hardware.',
    },
    {
      icon: <BrainCircuit className="h-6 w-6 text-primary" />,
      title: 'AI Voice Intelligence',
      description:
        'Real-time transcription, emotion detection, semantic analysis, and autonomous conversational agents.',
    },
    {
      icon: <Activity className="h-6 w-6 text-primary" />,
      title: 'RTB & Marketplace',
      description:
        'Sub-second auction dynamics. Buy and sell calls dynamically with Ping/Post frameworks built into the core.',
    },
    {
      icon: <PhoneCall className="h-6 w-6 text-primary" />,
      title: 'Advanced Telephony',
      description:
        'DID provisioning, IVR flows, sticky routing, concurrency caps, and granular dialer management.',
    },
  ];

  return (
    <section className="border-b border-border/40 py-24 bg-background">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-16 max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">System Capabilities.</h2>
          <p className="mt-4 text-muted-foreground">
            Built from the ground up for zero latency, massive concurrency, and complex programmatic
            call routing. Forget SaaS toys; this is infrastructure.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, i) => (
            <div
              key={i}
              className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-6 transition-all hover:border-primary/50 hover:shadow-[0_0_30px_-5px_rgba(34,197,94,0.1)]"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                {feature.icon}
              </div>
              <h3 className="mb-2 font-semibold tracking-tight text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>

              {/* Subtle hover gradient inside the card */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
