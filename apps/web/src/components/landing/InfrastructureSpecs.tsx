import { Database, Network, Shield, Cpu } from 'lucide-react';

export function InfrastructureSpecs() {
  const specs = [
    {
      title: 'Bare Metal Deployment',
      value: 'Hetzner CX33',
      icon: <Cpu className="h-4 w-4" />,
    },
    {
      title: 'Database Engine',
      value: 'PostgreSQL 16',
      icon: <Database className="h-4 w-4" />,
    },
    {
      title: 'Telephony Switch',
      value: 'FreeSWITCH',
      icon: <Network className="h-4 w-4" />,
    },
    {
      title: 'Security & TLS',
      value: 'Strict WSS',
      icon: <Shield className="h-4 w-4" />,
    },
  ];

  return (
    <section id="infrastructure" className="border-b border-border/40 bg-card py-24">
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-12">
          <div className="max-w-xl flex-1">
            <h2 className="text-3xl font-bold tracking-tight">Hosted on raw iron.</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              We bypass the bloat of public clouds. By deploying directly on dedicated Hetzner
              infrastructure and utilizing highly tuned FreeSWITCH instances, Hopwhistle achieves
              routing latencies impossible on typical serverless architectures.
            </p>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              When every millisecond dictates auction win rates and call connection success, you
              can&apos;t afford shared environments.
            </p>
          </div>

          <div className="flex-1">
            <div className="grid gap-4 sm:grid-cols-2">
              {specs.map((spec, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/50 p-4"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {spec.icon}
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {spec.title}
                    </span>
                  </div>
                  <span className="font-mono text-lg font-medium text-foreground">
                    {spec.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
