import { CapabilityStrip } from '@/components/landing/CapabilityStrip';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { HeroCommandCenter } from '@/components/landing/HeroCommandCenter';
import { InfrastructureSpecs } from '@/components/landing/InfrastructureSpecs';
import { LandingHeader } from '@/components/landing/LandingHeader';

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/30">
      <LandingHeader />
      <main className="flex-1 flex flex-col">
        <HeroCommandCenter />
        <CapabilityStrip />
        <FeatureGrid />
        <InfrastructureSpecs />
        <FinalCTA />
      </main>
    </div>
  );
}
