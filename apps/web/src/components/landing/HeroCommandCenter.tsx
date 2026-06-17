import { ArrowRight, Terminal } from 'lucide-react';

export function HeroCommandCenter() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      {/* Background technical grid and gradient */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-primary/20 opacity-20 blur-[100px]"></div>

      <div className="container relative mx-auto px-4 py-24 md:px-8 md:py-32 lg:py-40">
        <div className="flex max-w-[800px] flex-col items-start gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Terminal className="h-3 w-3" />
            <span>v1.0.0 Institutional Release</span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
            The Telephony <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
              Command Center.
            </span>
          </h1>

          <p className="max-w-[600px] text-lg text-muted-foreground sm:text-xl">
            An institutional-grade call intelligence, RTB, and performance marketing operating
            system for companies that buy, sell, route, record, and monetize scale.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <a
              href="mailto:jimmy@leadzer.io"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Request Access
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <a
              href="#infrastructure"
              className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-transparent px-8 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              View Specifications
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
