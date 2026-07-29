import { ResearchConfigForm } from '@/features/industry-research/ResearchConfigForm';

export const metadata = { title: 'New investigation — Industry Research' };

export default function Page() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="ir-eyebrow">New investigation</div>
        <h1 className="ir-h1" style={{ marginTop: 4 }}>
          Scope a market-entry investigation
        </h1>
        <p className="ir-muted" style={{ marginTop: 4, fontSize: 14 }}>
          Nothing runs until you launch it. A first pass takes under two minutes.
        </p>
      </div>
      <ResearchConfigForm />
    </div>
  );
}
