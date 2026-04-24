'use client';

import { useState } from 'react';
import { 
  Users, 
  Search, 
  Filter, 
  Download, 
  Upload,
  X,
  Star,
  Activity,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Music,
  ShieldCheck,
  MoreVertical,
  PlayCircle
} from 'lucide-react';
import { fans } from '../data/demo-music-data';
import type { FanProfile } from '../types';

export function FanDatabaseTable() {
  const [search, setSearch] = useState('');
  const [selectedFan, setSelectedFan] = useState<FanProfile | null>(null);
  const [showFullPhone, setShowFullPhone] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const handleExport = () => {
    const csvContent = 'data:text/csv;charset=utf-8,Name,Phone,City,Segment,Source\n' + 
      filteredFans.map(f => `${f.name},${f.phone},${f.city},${f.segment},${f.source}`).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'fan_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredFans = fans.filter(f => 
    f.name.toLowerCase().includes(search.toLowerCase()) || 
    f.city.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Total Opted-In</div>
          <div className="mt-2 text-2xl font-bold m-text-text">45,000</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Superfans</div>
          <div className="mt-2 text-2xl font-bold m-text-accent">4,200</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Avg Eng. Score</div>
          <div className="mt-2 text-2xl font-bold m-text-text">72/100</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Verified Actions</div>
          <div className="mt-2 text-2xl font-bold m-text-text">18,450</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Opt-Out Rate</div>
          <div className="mt-2 text-2xl font-bold m-text-text">1.2%</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Top Source</div>
          <div className="mt-2 text-xl font-bold m-text-text truncate" title="Merch Checkout">Merch Checkout</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-[var(--m-surface)] p-4 border border-[var(--m-border-2)] rounded-lg">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 m-text-dim" />
            <input 
              type="text" 
              placeholder="Search fans..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md pl-9 pr-4 py-2 text-sm text-[var(--m-text)] focus:border-[var(--m-accent)] focus:outline-none transition-colors"
            />
          </div>
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md text-sm font-medium hover:bg-[var(--m-border-2)] transition-colors" 
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4" /> Filters
          </button>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="flex items-center gap-2 px-3 py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md text-sm font-medium hover:bg-[var(--m-border-2)] transition-colors cursor-pointer">
            <Upload className="h-4 w-4" /> Import
            <input type="file" className="hidden" accept=".csv" onChange={() => {}} />
          </label>
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-[var(--m-accent)] text-white rounded-md text-sm font-medium hover:bg-violet-600 transition-colors" 
            onClick={handleExport}
          >
            <Download className="h-4 w-4" /> Export Segment
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Segment</label>
            <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded p-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]">
              <option>All Segments</option>
              <option>Superfan</option>
              <option>Casual</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Source</label>
            <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded p-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]">
              <option>All Sources</option>
              <option>Spotify Presave</option>
              <option>Merch Checkout</option>
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="m-card overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[var(--m-surface-2)] border-b border-[var(--m-border-2)] text-[11px] uppercase tracking-wider m-text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Fan</th>
              <th className="px-4 py-3 font-semibold">City / Market</th>
              <th className="px-4 py-3 font-semibold">Segment</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Eng. Score</th>
              <th className="px-4 py-3 font-semibold">Verified Actions</th>
              <th className="px-4 py-3 font-semibold">Consent</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--m-border-2)]">
            {filteredFans.map(fan => (
              <tr 
                key={fan.id} 
                onClick={() => setSelectedFan(fan)}
                className="hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold m-text-text">{fan.name}</div>
                  <div className="text-xs m-text-dim">xxxxxx{fan.phone.slice(-4)}</div>
                </td>
                <td className="px-4 py-3 m-text-dim">{fan.city}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-xs">
                    {fan.segment.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 m-text-dim text-xs capitalize">{fan.source.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-[var(--m-surface-2)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--m-accent)]" style={{ width: `${fan.engagementScore}%` }} />
                    </div>
                    <span className="text-xs m-text-text font-mono">{fan.engagementScore}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono m-text-dim">{fan.verifiedActions}</td>
                <td className="px-4 py-3">
                  {fan.consentStatus === 'opted_in' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                      <CheckCircle2 className="h-3 w-3" /> Opted In
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-rose-400 bg-rose-400/10 px-2 py-1 rounded">
                      <AlertTriangle className="h-3 w-3" /> {fan.consentStatus}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button className="p-1 hover:bg-[var(--m-surface-2)] rounded m-text-muted hover:text-[var(--m-text)] transition-colors" onClick={(e) => { e.stopPropagation(); setSelectedFan(fan); setShowFullPhone(false); }}>
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Drawer */}
      {selectedFan && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setSelectedFan(null)}>
          <div 
            className="w-full max-w-lg bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-full overflow-y-auto flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
              <div>
                <h2 className="text-xl font-bold m-text-text">{selectedFan.name}</h2>
                <div className="flex items-center gap-2 text-sm m-text-dim mt-1">
                  <span className="font-mono">{selectedFan.id}</span>
                  <span>•</span>
                  <span>{showFullPhone ? selectedFan.phone : `+1 XXX-XXX-${selectedFan.phone.slice(-4)}`}</span>
                  {!showFullPhone && (
                    <button onClick={() => setShowFullPhone(true)} className="ml-2 text-xs text-[var(--m-accent)] hover:underline border border-[var(--m-border-2)] px-2 py-0.5 rounded">Reveal</button>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedFan(null)} className="p-2 hover:bg-[var(--m-border-2)] rounded-full transition-colors">
                <X className="h-5 w-5 m-text-muted" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin className="h-3 w-3"/> City / Market</div>
                  <div className="font-semibold">{selectedFan.city}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Star className="h-3 w-3"/> Segment</div>
                  <div className="font-semibold capitalize">{selectedFan.segment.replace(/_/g, ' ')}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Music className="h-3 w-3"/> Top Artist</div>
                  <div className="font-semibold">{selectedFan.favoriteArtist}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Activity className="h-3 w-3"/> Eng. Score</div>
                  <div className="font-semibold text-[var(--m-accent)]">{selectedFan.engagementScore}/100</div>
                </div>
              </div>

              {/* Compliance */}
              <div className="border border-[var(--m-border-2)] rounded-lg overflow-hidden">
                <div className="bg-[var(--m-surface-2)] px-4 py-2 border-b border-[var(--m-border-2)] flex items-center gap-2 font-semibold text-sm">
                  <ShieldCheck className="h-4 w-4 m-text-accent" /> Consent & Compliance
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="flex justify-between border-b border-[var(--m-border)] pb-2">
                    <span className="m-text-dim">Status</span>
                    <span className={selectedFan.consentStatus === 'opted_in' ? 'text-emerald-400' : 'text-rose-400'}>{selectedFan.consentStatus.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--m-border)] pb-2">
                    <span className="m-text-dim">Source</span>
                    <span className="capitalize">{selectedFan.source.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="m-text-dim">TCPA Verified</span>
                    <span className="text-emerald-400">Yes - Double Opt-In</span>
                  </div>
                </div>
              </div>

              {/* Proof Records (Campaign History) */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider m-text-muted mb-4 border-b border-[var(--m-border-2)] pb-2">Recent Campaign Proof</h3>
                <div className="space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="bg-[var(--m-bg)] border border-[var(--m-border)] p-3 rounded-md">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-semibold text-sm">Tour On-Sale Campaign</div>
                          <div className="text-xs m-text-dim">Apr 20, 2026 • 2m 14s</div>
                        </div>
                        <span className="text-[10px] bg-emerald-400/10 text-emerald-400 px-2 py-0.5 rounded uppercase font-semibold border border-emerald-400/20">Ticket Intent</span>
                      </div>
                      <div className="bg-[var(--m-surface-2)] p-2 rounded text-xs m-text-dim font-mono mb-2">
                        <span className="text-[var(--m-accent)]">AI:</span> Are you planning to grab tickets for the LA show?<br/>
                        <span className="text-[var(--m-text)]">Fan:</span> Yes absolutely, when do they drop?
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <button className="flex items-center gap-1 text-xs text-[var(--m-accent)] hover:underline">
                          <PlayCircle className="h-3 w-3" /> Play Recording
                        </button>
                        <span className="text-xs m-text-muted font-mono">Proof ID: pr-7x9{i}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Action */}
              <div className="bg-[var(--m-accent)]/10 border border-[var(--m-accent)]/30 rounded-lg p-4">
                <div className="text-sm font-bold text-[var(--m-accent)] mb-1">Recommended Next Action</div>
                <div className="text-sm m-text-text">Add to <span className="font-semibold">Early Access VIP Waitlist</span> based on consistent engagement and recent ticket intent verification.</div>
                <button 
                  className="mt-3 w-full py-2 bg-[var(--m-accent)] text-white rounded text-sm font-semibold hover:bg-violet-600 transition-colors disabled:opacity-50"
                  onClick={() => {
                    const btn = document.getElementById('sms-btn-vip');
                    if (btn) btn.innerText = 'Sent!';
                    setTimeout(() => { if (btn) btn.innerText = 'Trigger VIP SMS Follow-Up'; }, 2000);
                  }}
                  id="sms-btn-vip"
                >
                  Trigger VIP SMS Follow-Up
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
