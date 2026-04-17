import React from 'react';

const CARRIER_PLANS: Record<string, string[]> = {
  Aetna: ['Level'],
  AHL: ['Level'],
  Aflac: ['Level', 'Modified'],
  'American Amicable': ['Level', 'Graded', 'Return of Premium'],
  CICA: ['Level', 'Guaranteed Issue'],
  Corebridge: ['Level', 'Guaranteed Issue'],
  Gerber: ['Guaranteed Issue'],
  GTL: ['Graded'],
  'Mutual of Omaha': ['Level', 'Guaranteed Issue'],
  SBLI: ['Level', 'Modified'],
  Securico: ['Level', 'Graded', 'Modified'],
  TransAmerica: ['Level', 'Graded'],
};

const CARRIERS = Object.keys(CARRIER_PLANS);

const DISPOSITIONS = [
  'Sale Made',
  'Application Submitted',
  'Callback Scheduled',
  'Follow-Up Scheduled',
  'Left Voicemail',
  'No Answer',
  'Not Interested',
  'Wrong Number',
  'Do Not Call',
];

interface DispositionPanelProps {
  dispositionSaved: boolean;
  selectedDisposition: string;
  setSelectedDisposition: (d: string) => void;
  saleCarrier: string;
  setSaleCarrier: (c: string) => void;
  salePlanType: string;
  setSalePlanType: (p: string) => void;
  saleAnnualPremium: string;
  setSaleAnnualPremium: (p: string) => void;
  handleSaveDisposition: () => void;
  handleSkipDisposition: () => void;
  onDispositionSelect: (d: string) => void;
}

export function DispositionPanel({
  dispositionSaved,
  selectedDisposition,
  setSelectedDisposition,
  saleCarrier,
  setSaleCarrier,
  salePlanType,
  setSalePlanType,
  saleAnnualPremium,
  setSaleAnnualPremium,
  handleSaveDisposition,
  handleSkipDisposition,
  onDispositionSelect,
}: DispositionPanelProps) {
  if (dispositionSaved) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background border border-border p-6 rounded">
        <div className="w-2 h-2 bg-primary mb-4" />
        <h3 className="text-sm font-mono uppercase tracking-widest text-primary mb-2">Disposition Logged</h3>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Awaiting next action</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-background p-4">
      <h3 className="text-sm font-mono uppercase tracking-widest text-foreground pb-4 border-b border-border mb-4">
        Call Disposition
      </h3>

      <div className="space-y-2 mb-6">
        {DISPOSITIONS.map(disposition => (
          <button
            key={disposition}
            onClick={() => {
              setSelectedDisposition(disposition);
              onDispositionSelect(disposition);
            }}
            className={
              'w-full p-3 rounded text-left text-xs font-mono uppercase tracking-widest transition-all border ' +
              (selectedDisposition === disposition
                ? 'bg-primary/10 border-primary text-primary'
                : 'bg-card border-border text-muted-foreground hover:bg-muted')
            }
          >
            {disposition}
          </button>
        ))}
      </div>

      {selectedDisposition === 'Sale Made' && (
        <div className="bg-card border border-border rounded p-4 mb-6 space-y-4">
          <h4 className="text-xs font-mono uppercase tracking-widest text-foreground pb-2 border-b border-border">
            Sale Parameters
          </h4>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">Carrier</label>
            <select
              value={saleCarrier}
              onChange={e => {
                setSaleCarrier(e.target.value);
                setSalePlanType('');
              }}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">Select Carrier...</option>
              {CARRIERS.map(carrier => (
                <option key={carrier} value={carrier}>
                  {carrier}
                </option>
              ))}
            </select>
          </div>
          {saleCarrier && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">Plan Type</label>
              <select
                value={salePlanType}
                onChange={e => setSalePlanType(e.target.value)}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary"
              >
                <option value="">Select Plan Type...</option>
                {CARRIER_PLANS[saleCarrier]?.map(plan => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">Annual Premium ($)</label>
            <input
              type="number"
              value={saleAnnualPremium}
              onChange={e => setSaleAnnualPremium(e.target.value)}
              placeholder="e.g. 1200"
              className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-xs font-mono focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      <div className="mt-auto space-y-2">
        <button
          onClick={handleSaveDisposition}
          disabled={
            !selectedDisposition ||
            (selectedDisposition === 'Sale Made' && (!saleCarrier || !salePlanType || !saleAnnualPremium))
          }
          className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          Save & Exit
        </button>
        <button
          onClick={handleSkipDisposition}
          className="w-full py-3 bg-card hover:bg-muted border border-border text-muted-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          Skip Entry
        </button>
      </div>
    </div>
  );
}
