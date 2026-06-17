import { ArrowRight } from 'lucide-react';

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-32 bg-background">
      {/* Background glow */}
      <div className="absolute inset-0 bg-primary/5"></div>
      <div className="absolute left-1/2 top-1/2 -z-10 h-[400px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]"></div>

      <div className="container relative mx-auto px-4 text-center md:px-8">
        <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Ready to deploy?</h2>
        <p className="mx-auto mt-6 max-w-[600px] text-lg text-muted-foreground">
          Hopwhistle is an invite-only platform. Request access to evaluate our infrastructure and
          begin onboarding your telephony operations.
        </p>

        <div className="mt-10 flex items-center justify-center">
          <a
            href="mailto:jimmy@leadzer.io"
            className="inline-flex h-14 items-center justify-center rounded-md bg-primary px-10 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:scale-105 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Request Institutional Access
            <ArrowRight className="ml-2 h-5 w-5" />
          </a>
        </div>
      </div>
    </section>
  );
}
