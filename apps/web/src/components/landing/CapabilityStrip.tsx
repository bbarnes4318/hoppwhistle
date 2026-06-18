'use client';

export function CapabilityStrip() {
  const integrations = [
    { name: 'TELNYX SIP', type: 'Carrier' },
    { name: 'TWILIO TRUNKING', type: 'Trunking' },
    { name: 'FASTIFY API', type: 'Framework' },
    { name: 'NEXT.JS WEB', type: 'Frontend' },
    { name: 'POSTGRESQL', type: 'Database' },
    { name: 'WEBRTC / SIP.JS', type: 'Protocol' },
  ];

  return (
    <div className="border-y border-slate-900 bg-[#070913]/90 py-10 relative overflow-hidden">
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500 mb-8">
          INTEGRATES WITH ENTERPRISE TELECOM INFRASTRUCTURE & MODERN CODESTACKS
        </p>
        <div className="grid grid-cols-2 gap-y-8 gap-x-4 sm:grid-cols-3 md:grid-cols-6 items-center justify-items-center">
          {integrations.map((item, i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center space-y-1 opacity-45 hover:opacity-85 transition-opacity duration-300 select-none group"
            >
              <span className="font-mono font-bold text-sm tracking-widest text-slate-300 group-hover:text-emerald-400 transition-colors">
                {item.name}
              </span>
              <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">
                {item.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
