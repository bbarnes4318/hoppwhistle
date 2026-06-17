export function CapabilityStrip() {
  const specs = [
    { label: 'Core Latency', value: '< 20ms' },
    { label: 'Routing Engine', value: 'Bionic' },
    { label: 'RTB Bidding', value: 'Sub-second' },
    { label: 'Infrastructure', value: 'Bare Metal' },
    { label: 'Concurrency', value: '10k+ CPS' },
  ];

  return (
    <div className="border-b border-border/40 bg-muted/30 py-4">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5 md:gap-8">
          {specs.map((spec, i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center space-y-1 text-center md:items-start md:text-left"
            >
              <span className="text-muted-foreground uppercase tracking-wider text-xs font-semibold">
                {spec.label}
              </span>
              <span className="font-mono font-medium text-foreground">{spec.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
