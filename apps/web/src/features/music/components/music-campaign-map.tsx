'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  aggregateByAreaCode,
  aggregateByState,
  calculateMarketScore,
  calculateRates,
  calculateRecommendation,
  GeoMetricPoint,
} from '@hopwhistle/shared';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  DollarSign,
  Globe,
  HelpCircle,
  MapPin,
  PauseCircle,
  Search,
  TrendingDown,
  TrendingUp,
  Volume2,
  Zap,
  ShieldCheck,
  RefreshCw,
  Sliders,
  Radio,
  Target,
  Maximize2,
  Plus,
  Minus
} from 'lucide-react';
import { generateMusicCampaignGeoMetrics, musicCampaigns } from '../data/music-campaign-geo-metrics';
import { cn } from '@/lib/utils';

// Client-only lazy loaders for map dependencies to ensure Next.js SSR builds don't crash
let DeckGL: any = null;
let ScatterplotLayer: any = null;
let maplibregl: any = null;

if (typeof window !== 'undefined') {
  DeckGL = require('@deck.gl/react').default;
  const layers = require('@deck.gl/layers');
  ScatterplotLayer = layers.ScatterplotLayer;
  maplibregl = require('maplibre-gl');
  require('maplibre-gl/dist/maplibre-gl.css');
}

type LayerMetric = 'answerRate' | 'verifiedActions' | 'proofRecords' | 'cpa' | 'fanDensity';
type DatePreset = 'day' | 'week' | 'month';
type Granularity = 'state' | 'area_code' | 'point';

export default function MusicCampaignMap() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedArtist, setSelectedArtist] = useState<string>('all');
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('week');
  const [selectedMetric, setSelectedMetric] = useState<LayerMetric>('verifiedActions');
  const [selectedGranularity, setSelectedGranularity] = useState<Granularity>('point');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [liveMode, setLiveMode] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showBottomPanel, setShowBottomPanel] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Selected point and hover states
  const [inspectedPoint, setInspectedPoint] = useState<GeoMetricPoint | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<GeoMetricPoint | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number } | null>(null);

  // Map camera viewport defaults (centered on continental US)
  const [viewState, setViewState] = useState({
    latitude: 37.8,
    longitude: -96.0,
    zoom: 3.8,
    pitch: 25,
    bearing: -5,
  });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  // Sync MapLibre base style layer with viewport camera updates
  useEffect(() => {
    if (!maplibregl || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      interactive: false, // Let Deck.gl controller manage zoom/pan drag gestures
      attributionControl: false,
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.jumpTo({
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing,
      });
    }
  }, [viewState]);

  // Load and filter raw fan data
  const rawPoints = useMemo(() => {
    return generateMusicCampaignGeoMetrics(selectedCampaign);
  }, [selectedCampaign]);

  // Filter raw points by selected artist, confidence rating, and search input
  const filteredPoints = useMemo(() => {
    return rawPoints.filter(p => {
      // Filter by artist if a specific one is selected
      if (selectedArtist !== 'all') {
        const campaignObj = musicCampaigns.find(c => c.id === p.campaignId);
        if (campaignObj?.artist !== selectedArtist) return false;
      }

      // Georeferencing confidence filter
      if (confidenceFilter !== 'all' && p.locationConfidence !== confidenceFilter) {
        return false;
      }

      // Search Query filter matches state, city, area code
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCity = p.city?.toLowerCase().includes(query);
        const matchesState = p.state?.toLowerCase().includes(query);
        const matchesAreaCode = p.areaCode?.includes(query);
        if (!matchesCity && !matchesState && !matchesAreaCode) {
          return false;
        }
      }

      return true;
    });
  }, [rawPoints, selectedArtist, confidenceFilter, searchQuery]);

  // Aggregate points based on granularity
  const aggregatedData = useMemo(() => {
    if (selectedGranularity === 'state') {
      return aggregateByState(filteredPoints);
    } else if (selectedGranularity === 'area_code') {
      return aggregateByAreaCode(filteredPoints);
    }
    return filteredPoints;
  }, [filteredPoints, selectedGranularity]);

  // Live Metric Overlays Calculations
  const metricsStats = useMemo(() => {
    let contacted = 0;
    let answered = 0;
    let listens = 0;
    let saves = 0;
    let spend = 0;
    let dnc = 0;
    let activeMarkets = new Set<string>();
    let wastedSpend = 0;

    filteredPoints.forEach(p => {
      contacted += p.contacted;
      answered += p.answered;
      listens += p.verifiedListens;
      saves += p.conversions;
      spend += p.spend;
      dnc += p.dnc;
      if (p.contacted > 0 && p.city) {
        activeMarkets.add(`${p.city}-${p.state}`);
      }
      // Outbound calls with zero conversions (saves) map to wasted spend
      if (p.conversions === 0) {
        wastedSpend += p.spend;
      }
    });

    const connectRate = contacted > 0 ? (answered / contacted) * 100 : 0;
    const cpa = saves > 0 ? spend / saves : 0;

    return {
      contacted,
      answered,
      listens,
      saves,
      spend,
      dnc,
      connectRate,
      cpa,
      activeMarketsCount: activeMarkets.size,
      wastedSpend,
    };
  }, [filteredPoints]);

  // Animated live radar pulse triggers
  const [pulses, setPulses] = useState<
    Array<{ id: string; lat: number; lng: number; size: number; color: number[] }>
  >([]);
  const pulseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!liveMode) {
      setPulses([]);
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
      return;
    }

    const triggerPulse = () => {
      if (aggregatedData.length === 0) return;
      const idx = Math.floor(Math.random() * Math.min(aggregatedData.length, 100));
      const p = aggregatedData[idx];
      if (!p) return;

      const colors = {
        answerRate: [34, 211, 238],       // Cyan
        verifiedActions: [16, 185, 129],  // Emerald
        proofRecords: [139, 92, 246],     // Violet
        cpa: [245, 158, 11],              // Amber
        fanDensity: [139, 92, 246],       // Violet
      };

      const c = colors[selectedMetric] || [139, 92, 246];

      const newPulse = {
        id: `m-pulse-${Date.now()}-${Math.random()}`,
        lat: p.latitude,
        lng: p.longitude,
        size: 0,
        color: c,
      };

      setPulses(prev => [...prev.slice(-15), newPulse]);
    };

    pulseTimerRef.current = setInterval(triggerPulse, 900);

    return () => {
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
    };
  }, [liveMode, aggregatedData, selectedMetric]);

  // Expand animated pulses in animation frame loop
  useEffect(() => {
    if (!liveMode) return;

    const updatePulseSizes = () => {
      setPulses(prev =>
        prev
          .map(p => ({ ...p, size: p.size + 1.1 }))
          .filter(p => p.size < 50)
      );
      animationFrameRef.current = requestAnimationFrame(updatePulseSizes);
    };

    animationFrameRef.current = requestAnimationFrame(updatePulseSizes);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [liveMode]);

  // Color Mapping Helper based on layer metric limits
  const getMetricColor = useCallback(
    (d: GeoMetricPoint, maxVal: number): number[] => {
      if (selectedMetric === 'cpa') {
        const cpaVal = d.costPerConversion || 0;
        if (cpaVal === 0) return [113, 113, 122];
        if (cpaVal < 1.15) return [16, 185, 129]; // Emerald Green (Optimal CPA)
        if (cpaVal < 2.0) return [245, 158, 11];  // Amber Gold (Average)
        return [239, 68, 68];                     // Coral Red (Inefficient)
      }

      let val = 0;
      if (selectedMetric === 'answerRate') val = d.answerRate || 0;
      else if (selectedMetric === 'verifiedActions') val = d.conversions || 0;
      else if (selectedMetric === 'proofRecords') val = d.verifiedListens || 0;
      else if (selectedMetric === 'fanDensity') val = d.contacted || 0;

      const intensity = Math.min(1, val / (maxVal || 1));

      if (selectedMetric === 'verifiedActions') {
        // Emerald / Teal Gradient
        return [16, Math.round(130 + 55 * intensity), Math.round(180 + 30 * intensity)];
      }
      if (selectedMetric === 'proofRecords') {
        // Violet Gradient
        return [Math.round(110 + 30 * intensity), 60, 255];
      }
      if (selectedMetric === 'answerRate') {
        // Cyan / Sky Gradient
        return [34, Math.round(160 + 51 * intensity), 238];
      }
      // Fan Density: Deep Violet to bright magenta-violet
      return [Math.round(139 + 30 * intensity), 92, Math.round(200 + 46 * intensity)];
    },
    [selectedMetric]
  );

  // Find max value in current dataset to scale colors
  const maxVal = useMemo(() => {
    if (aggregatedData.length === 0) return 1;
    return Math.max(
      ...aggregatedData.map(p => {
        if (selectedMetric === 'answerRate') return p.answerRate || 0;
        if (selectedMetric === 'verifiedActions') return p.conversions || 0;
        if (selectedMetric === 'proofRecords') return p.verifiedListens || 0;
        if (selectedMetric === 'fanDensity') return p.contacted || 0;
        return p.costPerConversion || 0;
      }),
      1
    );
  }, [aggregatedData, selectedMetric]);

  // Construct Deck.gl scatter layers
  const deckLayers = useMemo(() => {
    if (!DeckGL) return [];

    const layersList = [];

    // Main Market nodes
    layersList.push(
      new ScatterplotLayer({
        id: 'fan-market-nodes',
        data: aggregatedData,
        getPosition: (d: GeoMetricPoint) => [d.longitude, d.latitude],
        getRadius: (d: GeoMetricPoint) => {
          const baseScale =
            selectedGranularity === 'state'
              ? 16000
              : selectedGranularity === 'area_code'
                ? 7000
                : 2200;
          const volumeFactor = Math.sqrt(d.contacted || 1) * baseScale;
          return Math.min(volumeFactor, baseScale * 45);
        },
        getFillColor: (d: GeoMetricPoint) => getMetricColor(d, maxVal),
        getLineColor: [39, 39, 42, 160],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        opacity: 0.85,
        onHover: (info: any) => {
          if (info.object) {
            setHoveredPoint(info.object);
            setHoverInfo({ x: info.x, y: info.y });
          } else {
            setHoveredPoint(null);
            setHoverInfo(null);
          }
        },
        onClick: (info: any) => {
          if (info.object) {
            setInspectedPoint(info.object);
            setSidebarOpen(true);
            setViewState(prev => ({
              ...prev,
              latitude: info.object.latitude - 0.15,
              longitude: info.object.longitude,
              zoom: Math.max(prev.zoom, 7),
            }));
          }
        },
        updateTriggers: {
          getRadius: [selectedGranularity],
          getFillColor: [selectedMetric, maxVal],
        },
      })
    );

    // Expanding active radar ripple layers
    if (liveMode && pulses.length > 0) {
      layersList.push(
        new ScatterplotLayer({
          id: 'fan-live-pulses',
          data: pulses,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: (d: any) => d.size * 850,
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d: any) => [...d.color, Math.max(0, 255 - d.size * 5)],
          lineWidthMinPixels: 1.5,
          stroked: true,
          pickable: false,
          updateTriggers: {
            getRadius: [pulses],
            getLineColor: [pulses],
          },
        })
      );
    }

    return layersList;
  }, [aggregatedData, selectedMetric, maxVal, liveMode, pulses, selectedGranularity, getMetricColor]);

  // Dynamic values formatting helper
  const getLayerMetricValue = (d: GeoMetricPoint) => {
    if (selectedMetric === 'answerRate') return `${d.answerRate || 0}%`;
    if (selectedMetric === 'verifiedActions') return `${d.conversions} saves`;
    if (selectedMetric === 'proofRecords') return `${d.verifiedListens} logs`;
    if (selectedMetric === 'cpa') return `$${(d.costPerConversion || 0).toFixed(2)}`;
    return `${d.contacted} fans`;
  };

  // Compile lists for the Bottom Market Intelligence panels
  const marketLists = useMemo(() => {
    const listSlice = aggregatedData.slice(0, 800);

    const sortedByAnswers = [...listSlice]
      .filter(p => p.contacted >= 8)
      .sort((a, b) => b.answerRate - a.answerRate)
      .slice(0, 5);

    const sortedByActions = [...listSlice]
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, 5);

    const sortedByCpa = [...listSlice]
      .filter(p => p.conversions >= 2)
      .sort((a, b) => (a.costPerConversion || 999) - (b.costPerConversion || 999))
      .slice(0, 5);

    const underperforming = [...listSlice]
      .filter(p => p.spend > 15 && p.conversions === 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    const nextToActivate = [...listSlice]
      .filter(p => p.contacted < 30 && p.answerRate > 35)
      .sort((a, b) => b.answerRate - a.answerRate)
      .slice(0, 5);

    return {
      sortedByAnswers,
      sortedByActions,
      sortedByCpa,
      underperforming,
      nextToActivate,
    };
  }, [aggregatedData]);

  // Center view and inspect selected market node
  const handleInspectMarket = (p: GeoMetricPoint) => {
    setInspectedPoint(p);
    setSidebarOpen(true);
    setViewState(prev => ({
      ...prev,
      latitude: p.latitude - 0.15,
      longitude: p.longitude,
      zoom: Math.max(prev.zoom, 7.5),
    }));
  };

  // Compile unique lists of artists dynamically
  const uniqueArtists = useMemo(() => {
    const set = new Set<string>();
    musicCampaigns.forEach(c => set.add(c.artist));
    return Array.from(set);
  }, []);

  const getMusicRecommendationText = (p: GeoMetricPoint) => {
    const score = calculateMarketScore(p);
    const label = p.label || 'Market';
    
    if (score >= 70) {
      return `${label} shows top-tier fan conversion metrics (Score: ${score}/100) with solid stream-save engagement. Recommended: Increase dialing intensity and allocate local Tour Ticket Pre-Sale priority.`;
    }
    if (score < 40) {
      return `${label} underperforms (Score: ${score}/100) with elevated opt-outs or high acquisition cost. Recommended: Mute dialer routing in this prefix sector immediately to protect sender reputation.`;
    }
    if (p.verifiedListens > 15 && p.conversions === 0) {
      return `${label} reports listener verifications but zero completed pre-saves. Recommended: Audit the voice-agent DSP redirect node or verify link attributions.`;
    }
    return `Early fan activity in ${label} is stable. Watch saves trends ahead of the next release window before expanding seating.`;
  };

  const getMusicBadge = (score: number) => {
    if (score >= 70) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-[10px] font-bold text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Scale Market
        </span>
      );
    }
    if (score < 40) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/20 bg-red-500/10 text-[10px] font-bold text-red-400">
          <PauseCircle className="h-3 w-3" /> Dial Hold
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-[10px] font-bold text-amber-400">
        <AlertTriangle className="h-3 w-3" /> Watch Status
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#09090B] text-[#FAFAFA] overflow-hidden select-none relative font-sans">
      
      {/* ─── Map Canvas Box (Full Viewport Background) ─── */}
      <div className="absolute inset-0 w-full h-full z-0 bg-[#09090B]">
        {DeckGL ? (
          <div className="relative w-full h-full">
            {/* Vector Basemap style element */}
            <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0 pointer-events-none" />

            {/* WebGL DeckGL layers overlay */}
            <DeckGL
              viewState={viewState}
              onViewStateChange={(e: any) => setViewState(e.viewState)}
              controller={{ doubleClickZoom: false, dragRotate: true }}
              layers={deckLayers}
              getCursor={({ isHovering }: any) => (isHovering ? 'pointer' : 'default')}
              style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'auto' }}
            />
          </div>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-slate-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--m-accent)] mb-2" />
            <span>Canvas overlay loading...</span>
          </div>
        )}
      </div>

      {/* ─── SECTION 1: Top Command Control Header ─── */}
      <header className="h-16 shrink-0 bg-[#0F0F11]/90 border-b border-white/5 flex flex-wrap items-center justify-between px-6 z-20 backdrop-blur-md gap-4 relative pointer-events-auto">
        
        {/* Title Group */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--m-accent-dim)] rounded-lg border border-[var(--m-accent)]/20">
            <Globe className="h-4 w-4 text-[var(--m-accent)]" />
          </div>
          <div>
            <h1 className="text-xs font-bold uppercase tracking-wider text-[#FAFAFA]">Campaign Map</h1>
            <p className="text-[10px] text-[#A1A1AA]">Live geographic intelligence for fan activation, proof, CPA, and market movement.</p>
          </div>
        </div>

        {/* Custom Premium Control Row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Campaign Filter */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Campaign</span>
            <select
              value={selectedCampaign}
              onChange={e => {
                setSelectedCampaign(e.target.value);
                setInspectedPoint(null);
              }}
              className="bg-[#18181B] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] cursor-pointer h-7"
            >
              <option value="all">All Campaigns</option>
              {musicCampaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Artist Filter */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Artist</span>
            <select
              value={selectedArtist}
              onChange={e => {
                setSelectedArtist(e.target.value);
                setInspectedPoint(null);
              }}
              className="bg-[#18181B] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] cursor-pointer h-7"
            >
              <option value="all">All Artists</option>
              {uniqueArtists.map(artist => (
                <option key={artist} value={artist}>{artist}</option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Timeline</span>
            <div className="bg-[#18181B] border border-white/10 rounded-lg p-0.5 flex h-7">
              {(['day', 'week', 'month'] as DatePreset[]).map(preset => (
                <button
                  key={preset}
                  onClick={() => setSelectedPreset(preset)}
                  className={cn(
                    "px-2.5 text-[9px] font-bold rounded-md uppercase transition-all",
                    selectedPreset === preset
                      ? "bg-[#27272A] text-[var(--m-accent)] shadow-xs"
                      : "text-[#71717A] hover:text-slate-300"
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Layer Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Visual Layer</span>
            <select
              value={selectedMetric}
              onChange={e => setSelectedMetric(e.target.value as LayerMetric)}
              className="bg-[#18181B] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] cursor-pointer h-7"
            >
              <option value="answerRate">Answer Rate</option>
              <option value="verifiedActions">Verified Actions</option>
              <option value="proofRecords">Proof Records</option>
              <option value="cpa">CPA Efficiency</option>
              <option value="fanDensity">Fan Density</option>
            </select>
          </div>

          {/* Granularity Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Granularity</span>
            <select
              value={selectedGranularity}
              onChange={e => {
                setSelectedGranularity(e.target.value as Granularity);
                setInspectedPoint(null);
              }}
              className="bg-[#18181B] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] cursor-pointer h-7"
            >
              <option value="state">U.S. State</option>
              <option value="area_code">Area Code (NPA)</option>
              <option value="point">Fan Nodes</option>
            </select>
          </div>

          {/* Confidence Filter */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Confidence</span>
            <select
              value={confidenceFilter}
              onChange={e => setConfidenceFilter(e.target.value)}
              className="bg-[#18181B] border border-white/10 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] cursor-pointer h-7"
            >
              <option value="all">All Grades</option>
              <option value="high">CRM Verified</option>
              <option value="medium">Rate Center</option>
              <option value="low">Approx. cent</option>
            </select>
          </div>

          {/* Live Pulse Radar Toggle */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Active Pulse</span>
            <button
              onClick={() => setLiveMode(!liveMode)}
              className={cn(
                "h-7 px-3 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                liveMode
                  ? "bg-[var(--m-accent-dim)] border-[var(--m-accent)]/30 text-[var(--m-accent)] shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                  : "bg-[#18181B] border-white/5 text-[#71717A]"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", liveMode ? "bg-[var(--m-accent)] animate-pulse" : "bg-zinc-600")} />
              Live {liveMode ? 'Active' : 'Off'}
            </button>
          </div>

          {/* Bottom lists toggle */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Market Lists</span>
            <button
              onClick={() => setShowBottomPanel(!showBottomPanel)}
              className={cn(
                "h-7 px-3 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                showBottomPanel
                  ? "bg-[var(--m-accent-dim)] border-[var(--m-accent)]/30 text-[var(--m-accent)] shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                  : "bg-[#18181B] border-white/5 text-slate-300"
              )}
            >
              <Sliders className="h-3 w-3" />
              {showBottomPanel ? 'Visible' : 'Hidden'}
            </button>
          </div>

          {/* Search Field */}
          <div className="flex flex-col gap-0.5 relative">
            <span className="text-[7.5px] font-bold text-[#71717A] uppercase tracking-widest">Filter Market</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3 w-3 text-[#71717A]" />
              <input
                type="text"
                placeholder="City, State, AC..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-[#18181B] border border-white/10 rounded-lg pl-7 pr-2.5 py-1 text-[11px] font-semibold text-slate-200 outline-none focus:border-[var(--m-accent)] h-7 w-32 placeholder-zinc-600"
              />
            </div>
          </div>
        </div>
      </header>

      {/* ─── SECTION 2: Floating Panels Content Overlay Area ─── */}
      <div className="flex-grow min-h-0 flex relative z-10 p-4 justify-end items-stretch pointer-events-none">
        
        {/* SECTION 5: Right Diagnostics Inspector / Selected Market */}
        <div className={cn("shrink-0 bg-[#0F0F11]/95 border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden pointer-events-auto shadow-2xl z-20 transition-all duration-300", sidebarOpen ? "w-full lg:w-96" : "w-0 border-none opacity-0 pointer-events-none")}>
          {inspectedPoint ? (
            <div className="flex flex-col h-full p-5 space-y-4 overflow-y-auto">
              {/* Detail Header */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[8px] font-bold text-[var(--m-accent)] tracking-wider uppercase">
                    <MapPin className="h-3.5 w-3.5" /> Local fan telemetry
                  </div>
                  <h2 className="text-base font-bold text-slate-100 leading-tight">
                    {inspectedPoint.label}
                  </h2>
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono border bg-zinc-800 border-white/5 text-[#A1A1AA] uppercase tracking-wider">
                    Confidence: {inspectedPoint.locationConfidence}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-[#71717A] hover:text-white bg-[#18181B] border border-white/5 hover:border-white/10 px-2 py-1 rounded-lg transition-all text-[10px] font-semibold"
                    title="Collapse Sidebar"
                  >
                    Hide
                  </button>
                  <button
                    onClick={() => setInspectedPoint(null)}
                    className="text-[#71717A] hover:text-white bg-[#18181B] border border-white/5 hover:border-white/10 p-1 rounded-lg transition-all text-sm leading-none h-6 w-6 flex items-center justify-center font-bold"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Geo Recommendation Block */}
              <div className="bg-[#18181B]/70 border border-white/5 rounded-xl p-4 space-y-2">
                <span className="text-[8px] font-bold text-[#71717A] uppercase tracking-widest">Recommended action</span>
                <div className="pt-0.5">
                  {getMusicBadge(calculateMarketScore(inspectedPoint))}
                </div>
                <p className="text-[10px] leading-relaxed text-[#A1A1AA] pt-2 border-t border-white/5">
                  {getMusicRecommendationText(inspectedPoint)}
                </p>
              </div>

              {/* Localized Dial Funnel */}
              <div className="space-y-2">
                <span className="text-[8px] font-bold text-[#71717A] uppercase tracking-wider">Localized Funnel</span>
                <div className="space-y-1.5 font-mono text-[10px] text-[#A1A1AA] bg-[#18181B]/40 p-3.5 rounded-xl border border-white/5">
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">Outbound Dials</span>
                    <span className="text-[#FAFAFA] font-bold">{inspectedPoint.contacted}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#FAFAFA]">{inspectedPoint.answered} <span className="text-[#71717A] text-[8px]">({inspectedPoint.answerRate || 0}%)</span></span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">Verified Listens</span>
                    <span className="text-sky-400 font-bold">{inspectedPoint.verifiedListens} <span className="text-[#71717A] text-[8px]">({inspectedPoint.listenRate || 0}%)</span></span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">VIP Opt-Ins</span>
                    <span className="text-[var(--m-warning)] font-bold">{inspectedPoint.optIns || 0}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">DSP Clickthroughs</span>
                    <span className="text-indigo-400 font-bold">{inspectedPoint.transfers} <span className="text-[#71717A] text-[8px]">({inspectedPoint.transferRate || 0}%)</span></span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">Pre-Saves</span>
                    <span className="text-[#10B981] font-bold">{inspectedPoint.conversions}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[#71717A] font-sans text-[9px] uppercase tracking-wider">Opt-outs (DNC)</span>
                    <span className="text-red-400 font-bold">{inspectedPoint.dnc || 0}</span>
                  </div>
                </div>
              </div>

              {/* Economic Attribution */}
              <div className="space-y-2">
                <span className="text-[8px] font-bold text-[#71717A] uppercase tracking-wider">Local budget yield</span>
                <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono font-bold">
                  <div className="bg-[#18181B]/40 border border-white/5 rounded-xl p-2.5">
                    <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider font-sans mb-0.5">Spend</div>
                    <div className="text-[#FAFAFA] font-semibold">${inspectedPoint.spend.toFixed(2)}</div>
                  </div>
                  <div className="bg-[#18181B]/40 border border-white/5 rounded-xl p-2.5">
                    <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider font-sans mb-0.5">Yield value</div>
                    <div className={cn("font-semibold", inspectedPoint.revenueMovement >= 0 ? "text-[#10B981]" : "text-red-400")}>
                      ${inspectedPoint.revenueMovement.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Efficiency telemetry */}
              <div className="space-y-2 flex-grow">
                <span className="text-[8px] font-bold text-[#71717A] uppercase tracking-wider">Efficiency analysis</span>
                <div className="space-y-1.5 font-mono text-[9px] text-[#A1A1AA] bg-[#18181B]/20 p-3 rounded-xl border border-white/5">
                  <div className="flex justify-between">
                    <span>Cost Per Connect:</span>
                    <span className="text-slate-300">${inspectedPoint.costPerAnswer?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost Per Save:</span>
                    <span className="text-[#10B981] font-bold">${inspectedPoint.costPerConversion?.toFixed(2) || '0.00'}</span>
                  </div>
                </div>
              </div>

              {/* Geo-Coordinates footer */}
              <div className="flex justify-between text-[8px] text-[#71717A] uppercase font-mono border-t border-white/5 pt-3 mt-auto">
                <span>Latitude: {inspectedPoint.latitude.toFixed(4)}</span>
                <span>Longitude: {inspectedPoint.longitude.toFixed(4)}</span>
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center p-5 text-center text-[#71717A] space-y-3 overflow-y-auto relative w-full">
              <div className="pt-2 w-full">
                <div className="flex justify-between items-center w-full border-b border-white/5 pb-2 mb-2">
                  <h3 className="text-xs font-bold text-slate-200">Diagnostics Terminal</h3>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-[#71717A] hover:text-white bg-[#18181B] border border-white/5 hover:border-white/10 px-2 py-1 rounded-lg transition-all text-[10px] font-semibold"
                    title="Collapse Sidebar"
                  >
                    Hide
                  </button>
                </div>
                <p className="text-[10px] mt-1 leading-normal text-zinc-400">
                  Select a market node on the map to run localized geo-intelligence diagnostics.
                </p>
              </div>

              {/* ─── 6 Global Metrics Grid ─── */}
              <div className="w-full grid grid-cols-2 gap-2 mt-1">
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Reached Fans</div>
                  <div className="text-sm font-mono font-bold text-slate-100">{metricsStats.contacted.toLocaleString()}</div>
                </div>
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Verified Actions</div>
                  <div className="text-sm font-mono font-bold text-[#10B981]">{metricsStats.saves.toLocaleString()}</div>
                </div>
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Proof Records</div>
                  <div className="text-sm font-mono font-bold text-sky-400">{metricsStats.listens.toLocaleString()}</div>
                </div>
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Average CPA</div>
                  <div className="text-sm font-mono font-bold text-[var(--m-warning)]">${metricsStats.cpa.toFixed(2)}</div>
                </div>
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Active Markets</div>
                  <div className="text-sm font-mono font-bold text-indigo-400">{metricsStats.activeMarketsCount}</div>
                </div>
                <div className="bg-[#18181B]/60 border border-white/5 rounded-xl p-2.5 text-left">
                  <div className="text-[8px] text-[#71717A] uppercase font-bold tracking-wider mb-0.5">Wasted Spend</div>
                  <div className="text-sm font-mono font-bold text-red-400">${metricsStats.wastedSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* ─── Compact Live Operations Status ─── */}
              <div className="w-full bg-[#18181B]/40 border border-white/5 rounded-xl p-3 text-left space-y-1.5 mt-auto">
                <div className="flex items-center justify-between border-b border-white/5 pb-1">
                  <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1">
                    <Radio className="h-3 w-3 text-[#10B981]" /> Operations Status
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                </div>
                <div className="space-y-1 font-mono text-[9px] text-[#A1A1AA]">
                  <div className="flex justify-between">
                    <span>Active nodes:</span>
                    <span className="text-slate-300">{aggregatedData.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Routing health:</span>
                    <span className="text-[#10B981]">99.8%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sync delay:</span>
                    <span className="text-slate-300">0.4s</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Styled Zoom Controls */}
        <div 
          className={cn(
            "absolute flex flex-col gap-1.5 bg-[#0F0F11]/90 border border-white/10 p-1 rounded-xl backdrop-blur-md z-20 shadow-md pointer-events-auto transition-all duration-300",
            sidebarOpen ? "right-[400px]" : "right-4"
          )}
          style={{ bottom: showBottomPanel ? '200px' : (sidebarOpen ? '16px' : '64px') }}
        >
          <button
            onClick={() => setViewState(v => ({ ...v, zoom: Math.min(v.zoom + 0.8, 16) }))}
            className="w-7 h-7 text-xs font-bold text-slate-300 hover:text-white bg-[#18181B] border border-white/5 hover:border-white/10 rounded-lg flex items-center justify-center transition-all"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewState(v => ({ ...v, zoom: Math.max(v.zoom - 0.8, 1) }))}
            className="w-7 h-7 text-xs font-bold text-slate-300 hover:text-white bg-[#18181B] border border-white/5 hover:border-white/10 rounded-lg flex items-center justify-center transition-all"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={() =>
              setViewState({
                latitude: 37.8,
                longitude: -96.0,
                zoom: 3.8,
                pitch: 25,
                bearing: -5,
              })
            }
            className="w-7 h-7 text-[8px] font-bold text-[var(--m-accent)] bg-[#18181B] border border-white/5 hover:border-white/10 rounded-lg flex items-center justify-center transition-all"
            title="Center View"
          >
            CTR
          </button>
        </div>

        {/* Reopen Sidebar Button */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute right-4 bg-[#0F0F11]/90 border border-white/10 px-3 py-2 rounded-xl backdrop-blur-md z-20 shadow-md pointer-events-auto text-xs font-bold text-slate-300 hover:text-white transition-all duration-300 flex items-center gap-1.5"
            style={{ bottom: showBottomPanel ? '200px' : '16px' }}
          >
            <Sliders className="h-3.5 w-3.5" />
            Show Diagnostics
          </button>
        )}

        {/* Map Legends Box */}
        <div 
          className="absolute left-4 bg-[#0F0F11]/95 border border-white/10 p-3 rounded-xl backdrop-blur-md max-w-xs shadow-lg z-20 pointer-events-auto transition-all duration-300"
          style={{ bottom: showBottomPanel ? '200px' : '16px' }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-[var(--m-accent-2)] animate-pulse" />
            <h3 className="text-[9px] font-bold uppercase tracking-wider text-slate-200">
              Layer Intensity
            </h3>
          </div>
          <div className="space-y-1 text-[8.5px] text-[#A1A1AA]">
            <p>
              Colors reflect the <span className="font-semibold text-slate-200">{selectedMetric}</span> layer. Nodes are sized based on dial volume.
            </p>
            <div className="h-1.5 w-full bg-gradient-to-r from-zinc-800 to-[var(--m-accent)] rounded border border-white/5" />
            <div className="flex justify-between text-[8px] font-mono text-[#71717A]">
              <span>Low</span>
              <span>High ({maxVal.toLocaleString()})</span>
            </div>
          </div>
        </div>

        {/* Hover tooltips */}
        {hoveredPoint && hoverInfo && (
          <div
            className="absolute pointer-events-none bg-[#0F0F11]/95 border border-white/10 p-2.5 rounded-xl shadow-xl backdrop-blur-md z-30 w-52 font-sans"
            style={{ left: hoverInfo.x + 15, top: hoverInfo.y - 45 }}
          >
            <div className="flex justify-between items-start gap-2 mb-1">
              <span className="text-xs font-bold text-slate-100">{hoveredPoint.label}</span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-mono border bg-zinc-800 border-white/5 text-[#A1A1AA]">
                {hoveredPoint.locationConfidence === 'high' ? 'CRM MATCH' : hoveredPoint.locationConfidence === 'medium' ? 'RATE CENT' : 'APPROX'}
              </span>
            </div>
            <div className="space-y-1 font-mono text-[9px] text-[#A1A1AA]">
              <div className="flex justify-between">
                <span>Contacted:</span>
                <span className="text-slate-200 font-bold">{hoveredPoint.contacted}</span>
              </div>
              <div className="flex justify-between">
                <span>Connects:</span>
                <span className="text-slate-200">
                  {hoveredPoint.answered} ({hoveredPoint.answerRate || 0}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span>Verified:</span>
                <span className="text-sky-400">
                  {hoveredPoint.verifiedListens} ({hoveredPoint.listenRate || 0}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span>Pre-Saves:</span>
                <span className="text-[#10B981] font-bold">{hoveredPoint.conversions}</span>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-1 mt-1 text-[8.5px] uppercase font-bold text-[#FAFAFA]">
                <span>Market Index:</span>
                <span className="text-[var(--m-accent)]">{calculateMarketScore(hoveredPoint)}/100</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── SECTION 4: Bottom Market Intelligence list panels (Floating and Toggled) ─── */}
        {showBottomPanel && (
          <div className={cn("absolute left-4 bottom-4 h-44 bg-[#0F0F11]/95 border border-white/10 grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-white/5 z-20 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md pointer-events-auto animate-fadeIn transition-all duration-300", sidebarOpen ? "right-[416px]" : "right-4")}>
            
            {/* Panel 1: Top Answer Rates */}
            <div className="p-3.5 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <Zap className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#FAFAFA]">Answer Rate</span>
              </div>
              <div className="space-y-1 mt-2 flex-grow overflow-y-auto">
                {marketLists.sortedByAnswers.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleInspectMarket(p)}
                    className="flex justify-between text-[10px] items-center text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                  >
                    <span className="truncate pr-2">{idx + 1}. {p.label}</span>
                    <span className="font-mono font-bold text-cyan-400 shrink-0">{p.answerRate}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 2: Top Verified Actions */}
            <div className="p-3.5 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#FAFAFA]">Verified Actions</span>
              </div>
              <div className="space-y-1 mt-2 flex-grow overflow-y-auto">
                {marketLists.sortedByActions.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleInspectMarket(p)}
                    className="flex justify-between text-[10px] items-center text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                  >
                    <span className="truncate pr-2">{idx + 1}. {p.label}</span>
                    <span className="font-mono font-bold text-emerald-400 shrink-0">{p.conversions}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3: Top CPA Efficiency */}
            <div className="p-3.5 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <Target className="h-3.5 w-3.5 text-[var(--m-warning)]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#FAFAFA]">CPA Efficiency</span>
              </div>
              <div className="space-y-1 mt-2 flex-grow overflow-y-auto">
                {marketLists.sortedByCpa.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleInspectMarket(p)}
                    className="flex justify-between text-[10px] items-center text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                  >
                    <span className="truncate pr-2">{idx + 1}. {p.label}</span>
                    <span className="font-mono font-bold text-[var(--m-warning)] shrink-0">${p.costPerConversion?.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 4: Underperforming Markets */}
            <div className="p-3.5 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#FAFAFA]">Underperforming</span>
              </div>
              <div className="space-y-1 mt-2 flex-grow overflow-y-auto">
                {marketLists.underperforming.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleInspectMarket(p)}
                    className="flex justify-between text-[10px] items-center text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                  >
                    <span className="truncate pr-2 text-red-400/80">{idx + 1}. {p.label}</span>
                    <span className="font-mono font-bold text-red-400 shrink-0">${Math.round(p.spend)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 5: Next Markets to Activate */}
            <div className="p-3.5 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#FAFAFA]">Next to Activate</span>
              </div>
              <div className="space-y-1 mt-2 flex-grow overflow-y-auto">
                {marketLists.nextToActivate.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => handleInspectMarket(p)}
                    className="flex justify-between text-[10px] items-center text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer transition-colors"
                  >
                    <span className="truncate pr-2 text-indigo-300">{idx + 1}. {p.label}</span>
                    <span className="font-mono font-bold text-indigo-400 shrink-0">{p.answerRate}%</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
