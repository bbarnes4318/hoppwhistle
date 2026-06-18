import { AIVoiceSection } from '@/components/landing/AIVoiceSection';
import { BuyerOperations } from '@/components/landing/BuyerOperations';
import { CallTrackingSection } from '@/components/landing/CallTrackingSection';
import { CapabilityStrip } from '@/components/landing/CapabilityStrip';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { Footer } from '@/components/landing/Footer';
import { HeroSection } from '@/components/landing/HeroSection';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { RecordingIntelligence } from '@/components/landing/RecordingIntelligence';
import { UseCases } from '@/components/landing/UseCases';
import { WhatWeDo } from '@/components/landing/WhatWeDo';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#070913] text-white flex flex-col font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      <LandingHeader />
      <main className="flex-1 flex flex-col">
        <HeroSection />
        <CapabilityStrip />
        <WhatWeDo />
        <FeatureGrid />
        <AIVoiceSection />
        <CallTrackingSection />
        <RecordingIntelligence />
        <BuyerOperations />
        <DashboardPreview />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
