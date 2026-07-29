'use client';

import { 
  Activity,
  Download,
  MapPin,
  MoreVertical,
  Music,
  PlayCircle,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { fans } from '../data/demo-music-data';
import type { FanProfile } from '../types';

// Helper text formatting functions
function formatSegment(seg: string) {
  switch (seg) {
    case 'superfan': return 'Superfan';
    case 'vip_list': return 'VIP List';
    case 'previous_merch': return 'Merch Buyer';
    case 'tour_city': return 'Tour City Fan';
    case 'stream_save': return 'Stream Saver';
    case 'fan_club_inactive': return 'Inactive Fan Club';
    case 'festival_audience': return 'Festival Audience';
    default: return seg.replace(/_/g, ' ');
  }
}

function formatSource(src: string) {
  switch (src) {
    case 'pre_save_page': return 'Spotify Presave';
    case 'merch_checkout': return 'Merch Checkout';
    case 'ticketing_partner': return 'Ticketing Partner';
    case 'qr_code': return 'QR Code';
    case 'sms_opt_in': return 'SMS Opt-In';
    case 'vip_waitlist': return 'VIP Waitlist';
    case 'fan_club': return 'Fan Club';
    default: return src.replace(/_/g, ' ');
  }
}

function maskPhoneNumber(num?: string) {
  if (!num) return '—';
  const cleaned = num.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 ${cleaned.slice(1, 4)}-***-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `+1 ${cleaned.slice(0, 3)}-***-${cleaned.slice(6)}`;
  }
  return num.replace(/(\+\d{3})\d{4}(\d{3})/, '$1-***-$2');
}

export function FanDatabaseTable() {
  const { toast } = useToast();
  const [fanList, setFanList] = useState<FanProfile[]>(fans);
  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [consentFilter, setConsentFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');

  const [selectedFan, setSelectedFan] = useState<FanProfile | null>(null);
  const [showFullPhone, setShowFullPhone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedFan(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExport = () => {
    const csvContent = 'data:text/csv;charset=utf-8,Name,Phone,City,Segment,Source,EngagementScore,VerifiedActions,Consent\n' + 
      filteredFans.map(f => `${f.name},${f.phone},${f.city},${f.segment},${f.source},${f.engagementScore},${f.verifiedActions},${f.consentStatus}`).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'audience_intelligence_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: 'Export Complete',
      description: `Successfully exported ${filteredFans.length} fan profiles as CSV.`,
    });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const newFans: FanProfile[] = [];
      lines.forEach((line, idx) => {
        if (idx === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('phone'))) {
          return; // skip header
        }
        const parts = line.split(',');
        if (parts.length >= 2) {
          const name = parts[0]?.trim() || `Imported Fan ${idx}`;
          const phone = parts[1]?.trim() || `+1 555-000-${1000 + idx}`;
          const city = parts[2]?.trim() || 'Austin';
          const segment = (parts[3]?.trim() || 'superfan') as any;
          const source = (parts[4]?.trim() || 'sms_opt_in') as any;
          newFans.push({
            id: `imported-${Date.now()}-${idx}`,
            name,
            phone,
            city,
            segment,
            source,
            engagementScore: Math.floor(Math.random() * 40) + 60,
            lastInteraction: new Date().toISOString(),
            verifiedActions: Math.floor(Math.random() * 3) + 1,
            preSaves: Math.floor(Math.random() * 2),
            favoriteArtist: 'Nona Ray',
            consentStatus: 'opted_in',
            totalInteractions: 1,
          });
        }
      });

      if (newFans.length > 0) {
        setFanList(prev => [...newFans, ...prev]);
        toast({
          title: 'Audience Imported',
          description: `Successfully loaded ${newFans.length} new fan profiles into segment.`,
        });
      } else {
        toast({
          title: 'Import Failed',
          description: 'Could not parse any valid fan records from CSV.',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);
  };

  // Filters logic
  const filteredFans = fanList.filter(f => {
    const matchesSearch = 
      f.name.toLowerCase().includes(search.toLowerCase()) || 
      f.city.toLowerCase().includes(search.toLowerCase()) ||
      f.phone.includes(search);
    const matchesSegment = segmentFilter === 'all' || f.segment === segmentFilter;
    const matchesSource = sourceFilter === 'all' || f.source === sourceFilter;
    const matchesMarket = marketFilter === 'all' || f.city === marketFilter;
    const matchesConsent = consentFilter === 'all' || f.consentStatus === consentFilter;
    
    let matchesScore = true;
    if (scoreFilter === '50') matchesScore = f.engagementScore >= 50;
    else if (scoreFilter === '70') matchesScore = f.engagementScore >= 70;
    else if (scoreFilter === '90') matchesScore = f.engagementScore >= 90;

    return matchesSearch && matchesSegment && matchesSource && matchesMarket && matchesConsent && matchesScore;
  });

  // Unique list of filters
  const uniqueSegments = Array.from(new Set(fanList.map(f => f.segment)));
  const uniqueSources = Array.from(new Set(fanList.map(f => f.source)));
  const uniqueMarkets = Array.from(new Set(fanList.map(f => f.city)));

  // Dynamic Insight aggregations
  const totalFiltered = filteredFans.length;
  const optedInCount = filteredFans.filter(f => f.consentStatus === 'opted_in').length;
  const optedOutCount = filteredFans.filter(f => f.consentStatus === 'opted_out').length;
  const pendingCount = filteredFans.filter(f => f.consentStatus === 'pending').length;
  const optInPct = totalFiltered > 0 ? Math.round((optedInCount / totalFiltered) * 100) : 0;

  // Segment insights
  const segmentCounts: Record<string, { count: number; totalScore: number }> = {};
  filteredFans.forEach(f => {
    if (!segmentCounts[f.segment]) segmentCounts[f.segment] = { count: 0, totalScore: 0 };
    segmentCounts[f.segment].count += 1;
    segmentCounts[f.segment].totalScore += f.engagementScore;
  });
  const sortedSegments = Object.entries(segmentCounts)
    .map(([segment, data]) => ({
      segment,
      count: data.count,
      avgScore: Math.round(data.totalScore / data.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Market insights
  const marketCounts: Record<string, { count: number; actions: number }> = {};
  filteredFans.forEach(f => {
    if (!marketCounts[f.city]) marketCounts[f.city] = { count: 0, actions: 0 };
    marketCounts[f.city].count += 1;
    marketCounts[f.city].actions += f.verifiedActions;
  });
  const sortedMarkets = Object.entries(marketCounts)
    .map(([city, data]) => ({
      city,
      count: data.count,
      actions: data.actions,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const avgEngagement = totalFiltered > 0 
    ? Math.round(filteredFans.reduce((acc, f) => acc + f.engagementScore, 0) / totalFiltered) 
    : 0;

  const totalActions = filteredFans.reduce((acc, f) => acc + f.verifiedActions, 0);  return (
    <div className="space-y-3">
      {/* Top compact header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--m-border-2)] pb-2 mb-1">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 text-[var(--m-text)] uppercase">
            <Users className="h-4.5 w-4.5 text-[var(--m-accent)]" /> Fan Database & Audience Intelligence
          </h1>
          <p className="text-[10px] text-[var(--m-muted)] mt-0.5">
            Segment opted-in fans by engagement, market, source, station affinity, and monetization readiness.
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".csv" 
            onChange={handleImportFile} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--m-surface-2)] hover:bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded text-[10px] font-bold text-[var(--m-text-2)] hover:text-[var(--m-text)] transition-colors"
          >
            <Upload className="h-3 w-3" /> Import Audience
          </button>
          
          <button 
            onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--m-surface-2)] hover:bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded text-[10px] font-bold text-[var(--m-text-2)] hover:text-[var(--m-text)] transition-colors"
          >
            <Download className="h-3 w-3" /> Export Segment
          </button>

          <button 
            onClick={() => {
              toast({
                title: 'Campaign Builder Opened',
                description: `Initiating campaign setup targeting ${filteredFans.length} active fan profiles.`,
              });
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-[var(--m-accent)] text-white rounded text-[10px] font-extrabold hover:bg-[#008be5] transition-colors"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Build Campaign
          </button>
        </div>
      </div>

      {/* Audience KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-1">
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Total Opt-In</span>
          <span className="text-sm font-bold text-[var(--m-text)] block mt-0.5 font-mono">
            {totalFiltered > 0 ? (totalFiltered * 1000).toLocaleString() : '0'}
          </span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px] border-l-2 border-l-[var(--m-accent)]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Superfans</span>
          <span className="text-sm font-bold text-[var(--m-accent)] block mt-0.5 font-mono">
            {filteredFans.filter(f => f.segment === 'superfan').length * 80}
          </span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Avg Engagement</span>
          <span className="text-sm font-bold text-[var(--m-text)] block mt-0.5 font-mono">
            {avgEngagement > 0 ? `${avgEngagement}/100` : '—'}
          </span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Verified Actions</span>
          <span className="text-sm font-bold text-[var(--m-accent-2)] block mt-0.5 font-mono">
            {totalActions.toLocaleString()}
          </span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Opt-Out Rate</span>
          <span className="text-sm font-bold text-red-650 block mt-0.5 font-mono">1.2%</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Monetized</span>
          <span className="text-sm font-bold text-emerald-700 block mt-0.5 font-mono">
            {Math.round(optInPct * 0.7)}% Ready
          </span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Top Source</span>
          <span className="text-[10px] font-bold text-[var(--m-text)] truncate block mt-1" title="Spotify Presave">Spotify Presave</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider block">Top Market</span>
          <span className="text-[10px] font-bold text-[var(--m-text)] truncate block mt-1" title="Austin">Austin</span>
        </div>
      </div>

      {/* Compact Filters bar */}
      <div className="bg-[var(--m-surface)] p-2 border border-[var(--m-border-2)] rounded flex flex-wrap items-center gap-2 mb-1.5">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--m-muted)]" />
          <input 
            type="text" 
            placeholder="Search fans, city, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded pl-8 pr-3 py-1 text-[11px] text-[var(--m-text)] focus:border-[var(--m-accent)] focus:outline-none transition-colors font-medium placeholder-[var(--m-dim)]"
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--m-muted)] hover:text-[var(--m-text)]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filters dropdowns */}
        <select 
          value={segmentFilter}
          onChange={(e) => setSegmentFilter(e.target.value)}
          className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded px-2 py-1 text-[10px] text-[var(--m-text-2)] font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
        >
          <option value="all">All Segments</option>
          {uniqueSegments.map(s => (
            <option key={s} value={s}>{formatSegment(s)}</option>
          ))}
        </select>

        <select 
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded px-2 py-1 text-[10px] text-[var(--m-text-2)] font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
        >
          <option value="all">All Sources</option>
          {uniqueSources.map(s => (
            <option key={s} value={s}>{formatSource(s)}</option>
          ))}
        </select>

        <select 
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded px-2 py-1 text-[10px] text-[var(--m-text-2)] font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
        >
          <option value="all">All Markets</option>
          {uniqueMarkets.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <select 
          value={consentFilter}
          onChange={(e) => setConsentFilter(e.target.value)}
          className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded px-2 py-1 text-[10px] text-[var(--m-text-2)] font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
        >
          <option value="all">All Consent</option>
          <option value="opted_in">Opted In</option>
          <option value="opted_out">Opted Out</option>
          <option value="pending">Pending</option>
        </select>

        <select 
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value)}
          className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded px-2 py-1 text-[10px] text-[var(--m-text-2)] font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
        >
          <option value="all">Any Score</option>
          <option value="50">Score &gt;= 50</option>
          <option value="70">Score &gt;= 70</option>
          <option value="90">Score &gt;= 90</option>
        </select>

        {(search || segmentFilter !== 'all' || sourceFilter !== 'all' || marketFilter !== 'all' || consentFilter !== 'all' || scoreFilter !== 'all') && (
          <button 
            onClick={() => {
              setSearch('');
              setSegmentFilter('all');
              setSourceFilter('all');
              setMarketFilter('all');
              setConsentFilter('all');
              setScoreFilter('all');
            }}
            className="text-[10px] font-extrabold text-[var(--m-accent)] hover:underline ml-auto"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left Side: Table (Col-Span 2) */}
        <div className="lg:col-span-2 m-card overflow-hidden flex flex-col h-[420px]">
          <div className="flex-grow overflow-y-auto pr-0.5">
            <table className="w-full text-left text-xs whitespace-nowrap border-collapse m-table m-dense-table sticky-header">
              <thead className="bg-[var(--m-surface-2)] border-b border-[var(--m-border-2)] text-[8px] uppercase tracking-wider text-[var(--m-muted)] sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 font-black">Fan Profile</th>
                  <th className="px-3 py-2 font-black">Market</th>
                  <th className="px-3 py-2 font-black">Segment</th>
                  <th className="px-3 py-2 font-black">Station Affinity</th>
                  <th className="px-3 py-2 font-black">Eng. Score</th>
                  <th className="px-3 py-2 font-black text-right">Actions</th>
                  <th className="px-3 py-2 font-black">Consent</th>
                  <th className="px-3 py-2 font-black text-center">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--m-border-2)] bg-[var(--m-surface)]">
                {filteredFans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-20 text-[var(--m-muted)] text-xs font-semibold">
                      No matching opted-in fans found. Try clearing filters.
                    </td>
                  </tr>
                ) : (
                  filteredFans.map(fan => (
                    <tr 
                      key={fan.id} 
                      onClick={() => {
                        setSelectedFan(fan);
                        setShowFullPhone(false);
                      }}
                      className="hover:bg-[var(--m-surface-2)] transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-bold text-[var(--m-text)] text-[11px]">{fan.name}</div>
                        <div className="text-[9px] text-[var(--m-muted)] mt-0.2 font-mono">{maskPhoneNumber(fan.phone)}</div>
                      </td>
                      <td className="px-3 py-1.5 text-[var(--m-text-2)] font-semibold text-[10px]">{fan.city}</td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.2 bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded text-[9px] font-bold text-[var(--m-text-2)]">
                          {formatSegment(fan.segment)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-[var(--m-text-2)] text-[10px] font-semibold flex items-center gap-1.5 mt-2">
                        <Music className="h-3 w-3 text-[var(--m-muted)] shrink-0" />
                        <span>{fan.favoriteArtist}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[var(--m-text)] font-extrabold font-mono w-4">{fan.engagementScore}</span>
                          <div className="w-12 h-1 bg-[var(--m-surface-3)] rounded-full overflow-hidden shrink-0">
                            <div className="h-full bg-[var(--m-accent)]" style={{ width: `${fan.engagementScore}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[var(--m-text-2)] font-extrabold text-right text-[10px]">
                        {fan.verifiedActions}
                      </td>
                      <td className="px-3 py-1.5">
                        {fan.consentStatus === 'opted_in' ? (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded uppercase">
                            Opted In
                          </span>
                        ) : fan.consentStatus === 'opted_out' ? (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded uppercase">
                            Opted Out
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-amber-700 bg-amber-50 border border-amber-250 px-1.5 py-0.2 rounded uppercase">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-center">
                          <button 
                            className="p-0.5 hover:bg-[var(--m-surface-3)] rounded text-[var(--m-muted)] hover:text-[var(--m-text)] transition-colors flex items-center justify-center border border-transparent hover:border-[var(--m-border)]" 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSelectedFan(fan); 
                              setShowFullPhone(false); 
                            }}
                          >
                            <MoreVertical className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Side: Insights Panel (Col-Span 1) */}
        <div className="m-card p-3.5 bg-[var(--m-surface)] flex flex-col justify-between h-[420px] overflow-y-auto shadow-sm">
          <div className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text)] flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5">
              <Activity className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Audience Insights
            </h2>

            {/* Consent Health */}
            <div className="space-y-1 bg-[var(--m-surface-3)] rounded p-2 border border-[var(--m-border-2)]">
              <div className="flex justify-between items-center text-[9px] font-bold text-[var(--m-muted)]">
                <span>CONSENT HEALTH</span>
                <span className="text-emerald-700">{optInPct}% OPT-IN RATE</span>
              </div>
              <div className="h-2 bg-[var(--m-surface)] rounded overflow-hidden flex">
                <div className="h-full bg-emerald-500" style={{ width: `${optInPct}%` }} title={`Opted In: ${optedInCount}`} />
                <div className="h-full bg-amber-500" style={{ width: `${totalFiltered > 0 ? (pendingCount / totalFiltered) * 100 : 0}%` }} title={`Pending: ${pendingCount}`} />
                <div className="h-full bg-rose-550" style={{ width: `${totalFiltered > 0 ? (optedOutCount / totalFiltered) * 100 : 0}%` }} title={`Opted Out: ${optedOutCount}`} />
              </div>
              <div className="flex justify-between text-[8px] text-[var(--m-muted)] font-semibold">
                <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Opt-in ({optedInCount})</span>
                <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Pending ({pendingCount})</span>
                <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Opt-out ({optedOutCount})</span>
              </div>
            </div>

            {/* Top Segments */}
            <div className="space-y-1.5">
              <h3 className="text-[8px] font-bold uppercase tracking-wider text-[var(--m-muted)] flex items-center gap-1">
                <Star className="h-3 w-3 text-[var(--m-accent)]" /> Top Filtered Segments
              </h3>
              <div className="space-y-1">
                {sortedSegments.map(s => (
                  <div key={s.segment} className="flex justify-between items-center bg-[var(--m-surface-2)] px-2 py-1 rounded border border-[var(--m-border-2)] text-[10px]">
                    <span className="font-bold text-[var(--m-text-2)]">{formatSegment(s.segment)}</span>
                    <div className="flex items-center gap-2 font-mono text-[9px]">
                      <span className="text-[var(--m-muted)]">{s.count} fans</span>
                      <span className="text-[var(--m-dim)]">|</span>
                      <span className="text-[var(--m-accent)] font-bold">{s.avgScore} Eng.</span>
                    </div>
                  </div>
                ))}
                {sortedSegments.length === 0 && (
                  <span className="text-[9px] text-[var(--m-dim)] block">No segment data.</span>
                )}
              </div>
            </div>

            {/* Top Markets */}
            <div className="space-y-1.5">
              <h3 className="text-[8px] font-bold uppercase tracking-wider text-[var(--m-muted)] flex items-center gap-1">
                <MapPin className="h-3 w-3 text-[var(--m-accent-2)]" /> Top Markets
              </h3>
              <div className="space-y-1">
                {sortedMarkets.map(m => (
                  <div key={m.city} className="flex justify-between items-center bg-[var(--m-surface-2)] px-2 py-1 rounded border border-[var(--m-border-2)] text-[10px]">
                    <span className="font-bold text-[var(--m-text-2)]">{m.city}</span>
                    <div className="flex items-center gap-2 font-mono text-[9px]">
                      <span className="text-[var(--m-muted)]">{m.count} fans</span>
                      <span className="text-[var(--m-dim)]">|</span>
                      <span className="text-[var(--m-accent-2)] font-bold">{m.actions} Actions</span>
                    </div>
                  </div>
                ))}
                {sortedMarkets.length === 0 && (
                  <span className="text-[9px] text-[var(--m-dim)] block">No market data.</span>
                )}
              </div>
            </div>
          </div>

          {/* Bottom insights block */}
          <div className="space-y-2.5 mt-3 pt-3 border-t border-[var(--m-border-2)]">
            {/* Sponsor Readiness */}
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded p-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse shrink-0" />
                <span className="text-[9px] font-extrabold text-emerald-700 uppercase tracking-wider">Sponsor Ready</span>
              </div>
              <div className="text-[9px] text-emerald-800 font-mono font-bold">
                {totalFiltered > 0 ? Math.round(totalFiltered * 3.4) : 0} Active Ad Slots
              </div>
            </div>

            {/* Recommended Play */}
            <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded p-2.5 space-y-1">
              <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--m-muted)] block">Recommended Play</span>
              <p className="text-[10px] text-[var(--m-text-2)] leading-normal">
                {segmentFilter === 'superfan' 
                  ? 'Superfans identified. Launch high-fidelity Voice Broadcast Campaign to promote Nona Ray VIP tickets.'
                  : 'Audience segment active. Deploy a direct sponsor integration play to monetize verified interaction inventory.'
                }
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Upgraded Detail Drawer */}
      {selectedFan && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs" onClick={() => setSelectedFan(null)}>
          <div 
            className="w-full max-w-xl bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-screen fixed top-0 right-0 flex flex-col shadow-2xl overflow-hidden animate-[m-slide-in_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pinned Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0">
              <div>
                <h2 className="text-sm font-bold text-[var(--m-text)] flex items-center gap-2 uppercase tracking-tight">
                  <Star className="h-4 w-4 text-amber-500 fill-current" /> {selectedFan.name}
                </h2>
                <div className="flex items-center gap-2 text-[10px] text-[var(--m-muted)] mt-1 font-semibold">
                  <span className="font-mono bg-[var(--m-surface-3)] px-1 rounded border border-[var(--m-border-2)] text-[var(--m-text-2)]">{selectedFan.id}</span>
                  <span>•</span>
                  <span className="font-mono text-[var(--m-text-2)]">{showFullPhone ? selectedFan.phone : maskPhoneNumber(selectedFan.phone)}</span>
                  {!showFullPhone && (
                    <button 
                      onClick={() => setShowFullPhone(true)} 
                      className="text-[8px] font-extrabold text-[var(--m-accent)] hover:underline border border-[var(--m-border-2)] px-1.5 py-0.2 rounded bg-[var(--m-surface-3)]"
                    >
                      Reveal DID
                    </button>
                  )}
                </div>
              </div>
              <button 
                onClick={() => setSelectedFan(null)} 
                className="p-1.5 hover:bg-[var(--m-surface-3)] rounded border border-[var(--m-border-2)] flex items-center justify-center bg-[var(--m-surface-2)] transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5 text-[var(--m-muted)]" />
              </button>
            </div>
 
            {/* Content Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Info Matrix */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-[var(--m-surface-2)] p-2.5 rounded border border-[var(--m-border-2)]">
                  <div className="text-[8px] text-[var(--m-muted)] uppercase tracking-wider mb-0.5 flex items-center gap-1 font-bold">
                    <MapPin className="h-3 w-3 shrink-0"/> Market Play
                  </div>
                  <div className="font-bold text-xs text-[var(--m-text)]">{selectedFan.city}</div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 rounded border border-[var(--m-border-2)]">
                  <div className="text-[8px] text-[var(--m-muted)] uppercase tracking-wider mb-0.5 flex items-center gap-1 font-bold">
                    <Star className="h-3 w-3 shrink-0"/> Audience Segment
                  </div>
                  <div className="font-bold text-xs text-[var(--m-text)]">{formatSegment(selectedFan.segment)}</div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 rounded border border-[var(--m-border-2)]">
                  <div className="text-[8px] text-[var(--m-muted)] uppercase tracking-wider mb-0.5 flex items-center gap-1 font-bold">
                    <Music className="h-3 w-3 shrink-0"/> Station Affinity
                  </div>
                  <div className="font-bold text-xs text-[var(--m-text)] truncate">{selectedFan.favoriteArtist}</div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 rounded border border-[var(--m-border-2)]">
                  <div className="text-[8px] text-[var(--m-muted)] uppercase tracking-wider mb-0.5 flex items-center gap-1 font-bold">
                    <Activity className="h-3 w-3 shrink-0"/> Engagement Score
                  </div>
                  <div className="font-bold text-xs text-[var(--m-accent)]">{selectedFan.engagementScore}/100</div>
                </div>
              </div>

              {/* Consent & Compliance Details */}
              <div className="border border-[var(--m-border-2)] rounded-lg overflow-hidden bg-[var(--m-surface)]">
                <div className="bg-[var(--m-surface-2)] px-3 py-1.5 border-b border-[var(--m-border-2)] flex items-center gap-2 font-black text-[8px] uppercase tracking-wider text-[var(--m-text-2)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Consent & Compliance Audit
                </div>
                <div className="p-3 space-y-1.5 text-[11px]">
                  <div className="flex justify-between border-b border-[var(--m-border-2)] pb-1">
                    <span className="text-[var(--m-muted)] font-semibold">Consent Status</span>
                    <span className={cn("font-bold uppercase", 
                      selectedFan.consentStatus === 'opted_in' ? 'text-emerald-700' : 'text-rose-700'
                    )}>
                      {selectedFan.consentStatus}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--m-border-2)] pb-1">
                    <span className="text-[var(--m-muted)] font-semibold">Opt-In Capture Source</span>
                    <span className="font-bold text-[var(--m-text-2)]">{formatSource(selectedFan.source)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--m-muted)] font-semibold">TCPA Compliance Method</span>
                    <span className="text-emerald-700 font-bold">Double Opt-In Signed</span>
                  </div>
                </div>
              </div>

              {/* Dynamic recommended play trigger block */}
              <div className="bg-[var(--m-surface-3)] border border-[var(--m-border-2)] rounded-lg p-3 space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)] flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-[var(--m-accent)]" /> Recommended Next Play Action
                </div>
                
                <div className="text-xs text-[var(--m-text-2)] leading-normal">
                  Fan displays high engagement on <span className="font-semibold text-[var(--m-text)]">{selectedFan.favoriteArtist}</span>, capturing <span className="font-bold text-[var(--m-accent-2)]">{selectedFan.verifiedActions} verified actions</span>.
                </div>

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button 
                    onClick={() => {
                      toast({ 
                        title: 'VIP Campaign Setup', 
                        description: `Initiated VIP Pre-Sale Campaign play for ${selectedFan.name}.` 
                      });
                    }}
                    className="py-1.5 px-2 bg-[var(--m-surface)] hover:bg-[var(--m-surface-2)] border border-[var(--m-border-2)] hover:border-[var(--m-accent)]/50 rounded text-[10px] font-bold text-[var(--m-text-2)] text-left truncate transition-all"
                  >
                    + VIP Pre-Sale Play
                  </button>
                  
                  <button 
                    onClick={() => {
                      toast({ 
                        title: 'Merch Drop Setup', 
                        description: `Initiated Capsule Merchandise drop play for ${selectedFan.name}.` 
                      });
                    }}
                    className="py-1.5 px-2 bg-[var(--m-surface)] hover:bg-[var(--m-surface-2)] border border-[var(--m-border-2)] hover:border-[var(--m-accent)]/50 rounded text-[10px] font-bold text-[var(--m-text-2)] text-left truncate transition-all"
                  >
                    + Merch Drop Play
                  </button>
                  
                  <button 
                    onClick={() => {
                      toast({ 
                        title: 'Compliance Request', 
                        description: `Requested suppression review for ${selectedFan.name}.`,
                        variant: 'destructive'
                      });
                    }}
                    className="py-1.5 px-2 bg-[var(--m-surface)] hover:bg-red-50 border border-[var(--m-border-2)] hover:border-red-500/50 rounded text-[10px] font-bold text-red-700 text-left truncate transition-all"
                  >
                    ⚠ Suppress Fan Review
                  </button>
                  
                  <button 
                    onClick={() => {
                      toast({ 
                        title: 'Sponsor Pipeline Update', 
                        description: `Added ${selectedFan.name} to Sponsor-Ready Audience segment.` 
                      });
                    }}
                    className="py-1.5 px-2 bg-[var(--m-surface)] hover:bg-emerald-50 border border-[var(--m-border-2)] hover:border-emerald-500/50 rounded text-[10px] font-bold text-emerald-700 text-left truncate transition-all"
                  >
                    ★ Flag Sponsor-Ready
                  </button>
                </div>
              </div>

              {/* Timeline History */}
              <div className="space-y-1.5">
                <h3 className="text-[9px] font-bold uppercase tracking-wider text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-1 flex justify-between">
                  <span>AUDIENCE TELEMETRY HISTORY</span>
                  <span className="font-mono text-[8px] text-[var(--m-accent)] font-bold">{selectedFan.totalInteractions} Interactions</span>
                </h3>
                <div className="space-y-2">
                  <div className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] p-2 rounded flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-[var(--m-text)] text-[11px]">Tour Ticket Pre-Sale Broadcast</div>
                      <div className="text-[9px] text-[var(--m-muted)] font-semibold mt-0.5">Apr 24, 2026 • 2m 14s • Routing: Inbound</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[8px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-bold uppercase">Ticket Intent</span>
                    </div>
                  </div>
                  
                  <div className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] p-2 rounded flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-[var(--m-text)] text-[11px]">Album Announcement Opt-In</div>
                      <div className="text-[9px] text-[var(--m-muted)] font-semibold mt-0.5">Apr 15, 2026 • Web QR Code Scan</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[8px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-bold uppercase">Opted In</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
