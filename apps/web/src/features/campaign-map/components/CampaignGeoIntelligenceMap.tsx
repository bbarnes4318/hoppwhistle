'use client';

import {
  GeoMetricPoint,
  aggregateByAreaCode,
  aggregateByState,
  calculateMarketScore,
  calculateRates,
  calculateRecommendation,
} from '@hopwhistle/shared';
import {
  AlertTriangle,
  CheckCircle2,
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
} from 'lucide-react';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import { generateMockCampaignGeoMetrics, mockCampaigns } from '../data/mockCampaignGeoMetrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DeckGL: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ScatterplotLayer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let maplibregl: any = null;

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DeckGL = require('@deck.gl/react').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const layers = require('@deck.gl/layers');
  ScatterplotLayer = layers.ScatterplotLayer;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  maplibregl = require('maplibre-gl');
  // Load MapLibre GL CSS
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('maplibre-gl/dist/maplibre-gl.css');
}

type MetricType =
  | 'contacted'
  | 'answered'
  | 'verifiedListens'
  | 'engagements'
  | 'optIns'
  | 'callbacks'
  | 'transfers'
  | 'conversions'
  | 'dnc'
  | 'spend'
  | 'revenue'
  | 'revenueMovement';

type GranularityType = 'state' | 'area_code' | 'npa_nxx' | 'point';

export default function CampaignGeoIntelligenceMap() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedPreset, setSelectedPreset] = useState<string>('month');
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('transfers');
  const [selectedGranularity, setSelectedGranularity] = useState<GranularityType>('point');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [liveMode, setLiveMode] = useState<boolean>(true);
  const [compareMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLegend, setShowLegend] = useState<boolean>(true);

  // Interactive selected items
  const [inspectedPoint, setInspectedPoint] = useState<GeoMetricPoint | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<GeoMetricPoint | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number } | null>(null);

  // Map viewport state
  const [viewState, setViewState] = useState({
    latitude: 37.8,
    longitude: -96,
    zoom: 3.8,
    pitch: 30,
    bearing: -10,
  });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  // Initialize MapLibre GL base map
  useEffect(() => {
    if (!maplibregl || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      interactive: false, // Let DeckGL handle zoom/pan gestures
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

  // Sync MapLibre base map camera with DeckGL viewState updates
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

  // Animated pulse state for Live Pulse Mode
  const [pulses, setPulses] = useState<
    Array<{ id: string; lat: number; lng: number; size: number; color: number[] }>
  >([]);
  const pulseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Load and memoize the massive 12,000 lead metric points
  const rawPoints = useMemo(() => {
    return generateMockCampaignGeoMetrics(selectedCampaign);
  }, [selectedCampaign]);

  // Apply filters to data points
  const filteredPoints = useMemo(() => {
    return rawPoints.filter(p => {
      // Confidence filter
      if (confidenceFilter !== 'all' && p.locationConfidence !== confidenceFilter) {
        return false;
      }
      // Search query filter (matches City, State, Area Code, Prefix)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCity = p.city?.toLowerCase().includes(query);
        const matchesState = p.state?.toLowerCase().includes(query);
        const matchesAreaCode = p.areaCode?.includes(query);
        const matchesNpaNxx = p.npaNxx?.includes(query);
        if (!matchesCity && !matchesState && !matchesAreaCode && !matchesNpaNxx) {
          return false;
        }
      }
      return true;
    });
  }, [rawPoints, confidenceFilter, searchQuery]);

  // Aggregate points based on granularity
  const aggregatedData = useMemo(() => {
    if (selectedGranularity === 'state') {
      return aggregateByState(filteredPoints);
    } else if (selectedGranularity === 'area_code') {
      return aggregateByAreaCode(filteredPoints);
    } else if (selectedGranularity === 'npa_nxx') {
      // Group by prefix
      const groups: Record<string, GeoMetricPoint[]> = {};
      filteredPoints.forEach(p => {
        const key = p.npaNxx || 'unknown';
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      return Object.entries(groups).map(([prefix, group]) => {
        const sum = group.reduce(
          (acc, curr) => {
            acc.contacted += curr.contacted;
            acc.answered += curr.answered;
            acc.verifiedListens += curr.verifiedListens;
            acc.engagements += curr.engagements;
            acc.optIns += curr.optIns;
            acc.callbacks += curr.callbacks;
            acc.transfers += curr.transfers;
            acc.conversions += curr.conversions;
            acc.dnc += curr.dnc;
            acc.spend += curr.spend;
            acc.revenue += curr.revenue;
            acc.revenueMovement += curr.revenueMovement;
            return acc;
          },
          {
            contacted: 0,
            answered: 0,
            verifiedListens: 0,
            engagements: 0,
            optIns: 0,
            callbacks: 0,
            transfers: 0,
            conversions: 0,
            dnc: 0,
            spend: 0,
            revenue: 0,
            revenueMovement: 0,
          }
        );

        const base: Partial<GeoMetricPoint> = {
          id: `prefix-${prefix}`,
          campaignId: group[0]?.campaignId || 'c1',
          label: `Prefix ${prefix.slice(0, 3)}-${prefix.slice(3)} (${group[0]?.city || 'Unknown'})`,
          state: group[0]?.state,
          city: group[0]?.city,
          npaNxx: prefix,
          latitude: group[0]?.latitude || 37.8,
          longitude: group[0]?.longitude || -96,
          locationSource: 'npa_nxx',
          locationConfidence: 'medium',
          ...sum,
        };
        return calculateRates(base) as GeoMetricPoint;
      });
    }
    // "point" granularity
    return filteredPoints;
  }, [filteredPoints, selectedGranularity]);

  // Generate top Lists for Bottom Strip
  const bottomAnalysis = useMemo(() => {
    // Pick first 500 nodes to sort efficiently
    const slice = aggregatedData.slice(0, 1000);

    // 1. Top answer rates
    const topAnswers = [...slice]
      .filter(p => p.contacted >= 10)
      .sort((a, b) => b.answerRate - a.answerRate)
      .slice(0, 5);

    // 2. Top verified listens volume
    const topListens = [...slice].sort((a, b) => b.verifiedListens - a.verifiedListens).slice(0, 5);

    // 3. Top transfer yield
    const topTransfers = [...slice]
      .filter(p => p.answered >= 5)
      .sort((a, b) => b.transferRate - a.transferRate)
      .slice(0, 5);

    // 4. Wasted Spend: High spend, zero conversions/transfers
    const wastedSpend = [...slice]
      .filter(p => p.spend > 25 && p.transfers === 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    // 5. High Revenue Markets
    const topRevenue = [...slice].sort((a, b) => b.revenueMovement - a.revenueMovement).slice(0, 5);

    return { topAnswers, topListens, topTransfers, wastedSpend, topRevenue };
  }, [aggregatedData]);

  // Handle live pulse animations
  useEffect(() => {
    if (!liveMode) {
      setPulses([]);
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
      return;
    }

    const triggerPulse = () => {
      if (aggregatedData.length === 0) return;
      // Randomly select one active point
      const idx = Math.floor(Math.random() * Math.min(aggregatedData.length, 100));
      const p = aggregatedData[idx];
      if (!p) return;

      const colors = {
        transfers: [16, 185, 129], // green
        conversions: [16, 185, 129], // green
        optIns: [245, 158, 11], // amber
        callbacks: [245, 158, 11], // amber
        verifiedListens: [34, 211, 238], // cyan
        spend: [239, 68, 68], // red
      };

      const c = colors[selectedMetric as keyof typeof colors] || [14, 165, 233]; // blue default

      const newPulse = {
        id: `pulse-${Date.now()}-${Math.random()}`,
        lat: p.latitude,
        lng: p.longitude,
        size: 0,
        color: c,
      };

      setPulses(prev => [...prev.slice(-20), newPulse]); // keep last 20 pulses max
    };

    pulseTimerRef.current = setInterval(triggerPulse, 800);

    return () => {
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
    };
  }, [liveMode, aggregatedData, selectedMetric]);

  // Animation frame loop for expanding live pulse rings
  useEffect(() => {
    if (!liveMode) return;

    const updatePulseSizes = () => {
      setPulses(
        prev => prev.map(p => ({ ...p, size: p.size + 1.2 })).filter(p => p.size < 60) // remove fully expanded
      );
      animationFrameRef.current = requestAnimationFrame(updatePulseSizes);
    };

    animationFrameRef.current = requestAnimationFrame(updatePulseSizes);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [liveMode]);

  // Color Mapping Helper
  const getMetricColor = useCallback(
    (val: number, max: number): number[] => {
      // Disciplined visual palettes (RGB arrays)
      if (selectedMetric === 'revenueMovement' || selectedMetric === 'revenue') {
        // Gold palette [234, 179, 8]
        const intensity = Math.min(1, val / (max || 1));
        return [Math.round(200 + 34 * intensity), Math.round(140 + 39 * intensity), 8];
      }
      if (selectedMetric === 'transfers' || selectedMetric === 'conversions') {
        // Green palette [16, 185, 129]
        const intensity = Math.min(1, val / (max || 1));
        return [16, Math.round(120 + 65 * intensity), Math.round(80 + 49 * intensity)];
      }
      if (selectedMetric === 'optIns' || selectedMetric === 'callbacks') {
        // Amber palette [245, 158, 11]
        const intensity = Math.min(1, val / (max || 1));
        return [245, Math.round(100 + 58 * intensity), 11];
      }
      if (selectedMetric === 'dnc') {
        // Muted red [239, 68, 68]
        const intensity = Math.min(1, val / (max || 1));
        return [Math.round(180 + 59 * intensity), 68, 68];
      }
      if (selectedMetric === 'verifiedListens') {
        // Cyan/Blue-white [34, 211, 238]
        const intensity = Math.min(1, val / (max || 1));
        return [Math.round(30 + 100 * intensity), 211, 238];
      }
      // Default Answered/Contacted: Electric blue [14, 165, 233]
      const intensity = Math.min(1, val / (max || 1));
      return [14, Math.round(120 + 45 * intensity), 233];
    },
    [selectedMetric]
  );

  // Find max value in dataset to normalize size/color scaling
  const maxVal = useMemo(() => {
    if (aggregatedData.length === 0) return 1;
    return Math.max(...aggregatedData.map(p => Number(p[selectedMetric]) || 0), 1);
  }, [aggregatedData, selectedMetric]);

  // Construct deck.gl Layer configurations
  const deckLayers = useMemo(() => {
    if (!DeckGL) return [];

    const layersList = [];

    // Base point markers sized by contacted volume and colored by metric value
    layersList.push(
      new ScatterplotLayer({
        id: 'market-nodes',
        data: aggregatedData,
        getPosition: (d: GeoMetricPoint) => [d.longitude, d.latitude],
        getRadius: (d: GeoMetricPoint) => {
          // Adjust base radius size based on granularity
          const baseScale =
            selectedGranularity === 'state'
              ? 18000
              : selectedGranularity === 'area_code'
                ? 8000
                : 2500;
          const volWeight = Math.sqrt(d.contacted || 1) * baseScale;
          return Math.min(volWeight, baseScale * 40);
        },
        getFillColor: (d: GeoMetricPoint) => {
          const val = Number(d[selectedMetric]) || 0;
          return getMetricColor(val, maxVal);
        },
        getLineColor: [30, 41, 59, 180],
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
            if (compareMode) {
              setComparisonPoint(info.object);
            } else {
              setInspectedPoint(info.object);
              // Gently pan camera closer to clicked point
              setViewState(prev => ({
                ...prev,
                latitude: info.object.latitude - 0.2, // offset slightly so side panel doesn't hide it
                longitude: info.object.longitude,
                zoom: Math.max(prev.zoom, 7),
              }));
            }
          }
        },
        updateTriggers: {
          getRadius: [selectedGranularity],
          getFillColor: [selectedMetric, maxVal],
        },
      })
    );

    // Overlay expanding animated pulse rings (radar pulses)
    if (liveMode && pulses.length > 0) {
      layersList.push(
        new ScatterplotLayer({
          id: 'live-pulses',
          data: pulses,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: (d: any) => d.size * 900,
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d: any) => [...d.color, Math.max(0, 255 - d.size * 4.2)],
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
  }, [
    aggregatedData,
    selectedMetric,
    maxVal,
    liveMode,
    pulses,
    selectedGranularity,
    compareMode,
    getMetricColor,
  ]);

  // Clean metrics formatting helper
  const formatMetricValue = (val: number) => {
    if (
      selectedMetric === 'revenue' ||
      selectedMetric === 'revenueMovement' ||
      selectedMetric === 'spend'
    ) {
      return `$${Math.round(val).toLocaleString()}`;
    }
    return Math.round(val).toLocaleString();
  };

  // State badges style
  const getRecommendationBadge = (rec: 'scale' | 'watch' | 'pause' | 'investigate') => {
    const config = {
      scale: {
        bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
        icon: CheckCircle2,
        label: 'Scale Market',
      },
      watch: {
        bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
        icon: HelpCircle,
        label: 'Pace & Watch',
      },
      pause: {
        bg: 'bg-red-500/10 border-red-500/30 text-red-400',
        icon: PauseCircle,
        label: 'Mute / Pause',
      },
      investigate: {
        bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
        icon: AlertTriangle,
        label: 'Investigate',
      },
    };
    const c = config[rec] || config.watch;
    return (
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold ${c.bg}`}
      >
        <c.icon className="h-4.5 w-4.5 shrink-0" />
        <span>{c.label}</span>
      </div>
    );
  };

  const getRecommendationText = (p: GeoMetricPoint) => {
    const rec = calculateRecommendation(p);
    const label = p.label || 'Market';
    const insights = {
      scale: `${label} exhibits exceptional conversion metrics, high answer yield, and solid listener quality. Highly recommend increasing dialing concurrency and agent seating here immediately.`,
      pause: `${label} has reached critical opt-out thresholds (DNC: ${p.dnc} calls) or unacceptable connect rates. Pause outbound operations in this prefix block immediately to safeguard carrier reputation.`,
      investigate: `${label} demonstrates strong initial verified listen signals (${p.verifiedListens} fans) but has zero conversions or transfers. Conduct an immediate audit on the IVR agent queue and script node configurations.`,
      watch: `${label} shows promising early engagement indicators, but call volumes are too sparse to confirm scaling. Watch this market's conversions over the next 48 hours.`,
    };
    return insights[rec];
  };

  const confidenceBadge = (conf: 'high' | 'medium' | 'low' | 'unknown') => {
    const config = {
      high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
      medium: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
      low: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
      unknown: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
    };
    const labels = {
      high: 'CRM Verified',
      medium: 'Rate Center Match',
      low: 'Area Code Center',
      unknown: 'Unmapped',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded text-[9px] font-mono border uppercase tracking-wider ${config[conf] || config.unknown}`}
      >
        {labels[conf] || conf}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden select-none relative font-sans">
      {/* 1. TOP CONTROL ROW (Command Center Panel) */}
      <div className="min-h-16 h-auto py-3 shrink-0 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 px-6 z-20 backdrop-blur-md">
        {/* Left Side Header */}
        <div className="flex items-center gap-4">
          <div className="p-2 bg-sky-500/10 rounded-lg border border-sky-500/20">
            <Globe className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-wider text-slate-100">
              Campaign Geography
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">
              See where answers, listens, transfers, and revenue are moving live.
            </p>
          </div>
        </div>

        {/* Dynamic Filters & Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Campaign Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Select Campaign
            </span>
            <select
              value={selectedCampaign}
              onChange={e => setSelectedCampaign(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none focus:border-sky-500 cursor-pointer h-7"
            >
              <option value="all">All Campaigns</option>
              {mockCampaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Preset Date Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Date Preset
            </span>
            <div className="bg-slate-950 border border-slate-800 rounded p-0.5 flex h-7">
              {['day', 'week', 'month'].map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPreset(p)}
                  className={`px-2 text-[10px] font-bold rounded uppercase transition-colors ${selectedPreset === p ? 'bg-slate-800 text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Metric Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Visual Layer Metric
            </span>
            <select
              value={selectedMetric}
              onChange={e => setSelectedMetric(e.target.value as MetricType)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none focus:border-sky-500 cursor-pointer h-7"
            >
              <option value="contacted">Outbound Dials</option>
              <option value="answered">Answers / Connects</option>
              <option value="verifiedListens">Verified Listens</option>
              <option value="engagements">Engagements</option>
              <option value="optIns">Opt-Ins / Callbacks</option>
              <option value="transfers">Transferred Payouts</option>
              <option value="conversions">Conversions</option>
              <option value="dnc">Opt-Outs (DNC)</option>
              <option value="spend">Dialer Cost (Spend)</option>
              <option value="revenueMovement">Revenue Movement</option>
            </select>
          </div>

          {/* Granularity Selector */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Granularity
            </span>
            <select
              value={selectedGranularity}
              onChange={e => setSelectedGranularity(e.target.value as GranularityType)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none focus:border-sky-500 cursor-pointer h-7"
            >
              <option value="state">U.S. State</option>
              <option value="area_code">Area Code (NPA)</option>
              <option value="npa_nxx">NPA-NXX Prefix</option>
              <option value="point">Individual Leads</option>
            </select>
          </div>

          {/* Location Confidence Filter */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Georef Confidence
            </span>
            <select
              value={confidenceFilter}
              onChange={e => setConfidenceFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-slate-200 outline-none focus:border-sky-500 cursor-pointer h-7"
            >
              <option value="all">All Confidence</option>
              <option value="high">CRM Verified Only</option>
              <option value="medium">Rate Center Match</option>
              <option value="low">Area Code Centroid</option>
            </select>
          </div>

          {/* Live Radar Toggle */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Live Pulse
            </span>
            <button
              onClick={() => setLiveMode(!liveMode)}
              className={`h-7 px-3 rounded text-xs font-bold border transition-all flex items-center gap-1.5 ${
                liveMode
                  ? 'bg-sky-500/10 border-sky-400 text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.15)]'
                  : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${liveMode ? 'bg-sky-400 animate-pulse' : 'bg-slate-600'}`}
              />
              Radar {liveMode ? 'On' : 'Off'}
            </button>
          </div>

          {/* Search bar */}
          <div className="flex flex-col gap-0.5 relative">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Search Market
            </span>
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="State, City, NPA..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded pl-7 pr-2.5 py-1 text-xs font-semibold text-slate-200 outline-none focus:border-sky-500 h-7 w-40 placeholder-slate-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. MAP AREA + FLOATING CONTROLS + SIDE PANEL */}
      <div className="flex-1 min-h-0 flex relative z-10">
        {/* Map Container */}
        <div className="flex-1 h-full w-full relative bg-slate-900">
          {DeckGL ? (
            <div className="relative w-full h-full">
              {/* MapLibre container rendering the dark matter vector base map underneath */}
              <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

              {/* DeckGL canvas drawing WebGL visualization layer overlays on top */}
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mb-2" />
              <span>Initializing WebGL Canvas...</span>
            </div>
          )}

          {/* Map Controls (Zoom / Camera Reset Overlay) */}
          <div className="absolute right-4 top-4 flex flex-col gap-2 bg-slate-900/90 border border-slate-800 p-1.5 rounded-lg backdrop-blur z-20">
            <button
              onClick={() => setViewState(v => ({ ...v, zoom: Math.min(v.zoom + 0.8, 16) }))}
              className="w-7 h-7 text-xs font-bold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 rounded flex items-center justify-center transition-colors"
            >
              +
            </button>
            <button
              onClick={() => setViewState(v => ({ ...v, zoom: Math.max(v.zoom - 0.8, 1) }))}
              className="w-7 h-7 text-xs font-bold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 rounded flex items-center justify-center transition-colors"
            >
              -
            </button>
            <button
              onClick={() =>
                setViewState({
                  latitude: 37.8,
                  longitude: -96,
                  zoom: 3.8,
                  pitch: 30,
                  bearing: -10,
                })
              }
              className="w-7 h-7 text-[10px] font-bold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 rounded flex items-center justify-center transition-colors"
              title="Reset View"
            >
              RST
            </button>
          </div>

          {/* Disclaimer Legend Overlay */}
          {showLegend ? (
            <div className="absolute left-4 bottom-4 bg-slate-950/95 border border-slate-800/80 p-3.5 rounded-xl backdrop-blur-md max-w-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] z-20">
              <div className="flex items-center justify-between gap-4 mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-200">
                    Radar Metrics Legend
                  </h3>
                </div>
                <button
                  onClick={() => setShowLegend(false)}
                  className="text-slate-400 hover:text-white p-0.5 hover:bg-slate-800 rounded transition-colors text-[10px] font-bold h-5 w-5 flex items-center justify-center border border-slate-800"
                  title="Close Legend"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-1.5 text-[9px] text-slate-400">
                <p>
                  Node sizes indicate total contacted call volume. Color scaling indicates intensity
                  of selected metric:{' '}
                  <span className="font-semibold text-slate-200">{selectedMetric}</span>.
                </p>
                <div className="h-2 w-full bg-gradient-to-r from-slate-900 to-sky-500 rounded my-1 border border-slate-800" />
                <div className="flex justify-between text-[8px] font-mono text-slate-500">
                  <span>MIN</span>
                  <span>MAX ({formatMetricValue(maxVal)})</span>
                </div>
                <p className="border-t border-slate-800/50 pt-1.5 text-[8px] leading-relaxed text-slate-500 italic">
                  Disclaimer: Locations are derived from lead metadata and phone-number market data.
                  Area-code and prefix locations are directional, not exact physical locations.
                </p>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLegend(true)}
              className="absolute left-4 bottom-4 bg-slate-950/95 border border-slate-800 p-2 rounded-xl hover:bg-slate-900 text-[10px] text-sky-400 font-bold flex items-center gap-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.5)] z-20 transition-all hover:scale-105"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Show Legend</span>
            </button>
          )}

          {/* Tooltip Overlay */}
          {hoveredPoint && hoverInfo && (
            <div
              className="absolute pointer-events-none bg-slate-950/95 border border-slate-800 p-3 rounded-lg shadow-xl backdrop-blur-md z-30 w-52"
              style={{ left: hoverInfo.x + 15, top: hoverInfo.y - 40 }}
            >
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-xs font-black text-slate-100">{hoveredPoint.label}</span>
                {confidenceBadge(hoveredPoint.locationConfidence)}
              </div>
              <div className="space-y-1 font-mono text-[9px] text-slate-400">
                <div className="flex justify-between">
                  <span>Dials:</span>
                  <span className="text-slate-200 font-bold">{hoveredPoint.contacted}</span>
                </div>
                <div className="flex justify-between">
                  <span>Answers:</span>
                  <span className="text-slate-200">
                    {hoveredPoint.answered} ({hoveredPoint.answerRate || 0}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Listens:</span>
                  <span className="text-slate-200">
                    {hoveredPoint.verifiedListens} ({hoveredPoint.listenRate || 0}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Transfers:</span>
                  <span className="text-emerald-400 font-bold">
                    {hoveredPoint.transfers} ({hoveredPoint.transferRate || 0}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Conversions:</span>
                  <span className="text-emerald-400 font-bold">{hoveredPoint.conversions}</span>
                </div>
                <div className="flex justify-between">
                  <span>Revenue:</span>
                  <span className="text-yellow-400 font-bold">
                    ${Math.round(hoveredPoint.revenueMovement || 0)}
                  </span>
                </div>
                <div className="border-t border-slate-800 pt-1 flex justify-between text-[8px] uppercase tracking-wider text-slate-500 font-bold">
                  <span>Performance:</span>
                  <span className="text-sky-400">{calculateMarketScore(hoveredPoint)}/100</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Side Inspector Intelligence Panel */}
        <div
          className={`w-80 shrink-0 border-l border-slate-800 bg-slate-900/95 flex flex-col h-full z-20 backdrop-blur transition-all duration-300 ${inspectedPoint ? 'translate-x-0' : 'translate-x-full absolute right-0 w-0 border-l-0 overflow-hidden'}`}
        >
          {inspectedPoint && (
            <div className="flex flex-col h-full overflow-y-auto p-5 space-y-5">
              {/* Panel Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1 text-[8px] font-bold text-sky-400 tracking-[0.2em] uppercase mb-1">
                    <MapPin className="h-3 w-3" /> Market Diagnostics
                  </div>
                  <h2 className="text-sm font-black text-slate-100 leading-tight mb-1">
                    {inspectedPoint.label}
                  </h2>
                  <div className="flex items-center gap-2">
                    {confidenceBadge(inspectedPoint.locationConfidence)}
                    <span className="text-[9px] font-mono text-slate-500">
                      AC: {inspectedPoint.areaCode || 'N/A'}{' '}
                      {inspectedPoint.nxx ? `-${inspectedPoint.nxx}` : ''}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setInspectedPoint(null)}
                  className="text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 p-1.5 rounded transition-colors"
                >
                  &times;
                </button>
              </div>

              {/* Recommendation Badge Section */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">
                  Geo-Recommendation
                </span>
                {getRecommendationBadge(calculateRecommendation(inspectedPoint))}
                <p className="text-[10px] leading-relaxed text-slate-300 pt-1.5 border-t border-slate-800/50">
                  {getRecommendationText(inspectedPoint)}
                </p>
              </div>

              {/* KPI Funnel Block */}
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider">
                  Outbound Call Funnel
                </span>
                <div className="space-y-1.5 font-mono text-[10px] text-slate-400 bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Outbound Dials
                    </span>
                    <span className="text-slate-200 font-bold">{inspectedPoint.contacted}</span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Answers
                    </span>
                    <span className="text-slate-200">
                      {inspectedPoint.answered}{' '}
                      <span className="text-slate-500 text-[8px]">
                        ({inspectedPoint.answerRate || 0}%)
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Verified Listens
                    </span>
                    <span className="text-sky-400 font-bold">
                      {inspectedPoint.verifiedListens}{' '}
                      <span className="text-slate-500 text-[8px]">
                        ({inspectedPoint.listenRate || 0}%)
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Engagements
                    </span>
                    <span className="text-indigo-400">
                      {inspectedPoint.engagements}{' '}
                      <span className="text-slate-500 text-[8px]">
                        ({inspectedPoint.engagementRate || 0}%)
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Opt-Ins / CBs
                    </span>
                    <span className="text-amber-400 font-bold">{inspectedPoint.optIns || 0}</span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Transferred Calls
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {inspectedPoint.transfers}{' '}
                      <span className="text-slate-500 text-[8px]">
                        ({inspectedPoint.transferRate || 0}%)
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-0.5 border-b border-slate-800/30">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      Conversions
                    </span>
                    <span className="text-emerald-400 font-bold">{inspectedPoint.conversions}</span>
                  </div>

                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                      DNC Requests
                    </span>
                    <span className="text-red-400 font-bold">{inspectedPoint.dnc || 0}</span>
                  </div>
                </div>
              </div>

              {/* Financial attribution */}
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider">
                  Financial Diagnostics
                </span>
                <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono font-bold">
                  <div className="bg-slate-950/40 border border-slate-800 rounded p-2">
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider font-sans mb-0.5">
                      Spent
                    </div>
                    <div className="text-slate-300 font-semibold">
                      ${Math.round(inspectedPoint.spend || 0)}
                    </div>
                  </div>
                  <div className="bg-slate-950/40 border border-slate-800 rounded p-2">
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider font-sans mb-0.5">
                      Revenue
                    </div>
                    <div
                      className={`font-semibold ${inspectedPoint.revenueMovement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      ${Math.round(inspectedPoint.revenueMovement || 0)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Telemetry Cost metrics */}
              <div className="space-y-2">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider">
                  Efficiency Ratios
                </span>
                <div className="space-y-1.5 font-mono text-[9px] text-slate-400 bg-slate-950/20 p-3 rounded-lg border border-slate-800/60">
                  <div className="flex justify-between">
                    <span>Cost Per Connect (CPC):</span>
                    <span className="text-slate-300">
                      ${inspectedPoint.costPerAnswer?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost Per Verified Listen:</span>
                    <span className="text-slate-300">
                      ${inspectedPoint.costPerVerifiedListen?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost Per Agent Transfer:</span>
                    <span className="text-slate-300 font-bold">
                      ${inspectedPoint.costPerTransfer?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost Per Conversion:</span>
                    <span className="text-emerald-400 font-bold">
                      ${inspectedPoint.costPerConversion?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Geographic Coordinates metadata */}
              <div className="flex justify-between text-[8px] text-slate-500 uppercase tracking-wider font-mono border-t border-slate-800 pt-3">
                <span>Lat: {inspectedPoint.latitude.toFixed(4)}</span>
                <span>Lng: {inspectedPoint.longitude.toFixed(4)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. BOTTOM INTEL STRIP (Horizontal list grids) */}
      <div className="h-32 shrink-0 bg-slate-900 border-t border-slate-800 grid grid-cols-5 divide-x divide-slate-800/60 z-20">
        {/* Panel 1: Top Connect Rates */}
        <div className="p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Zap className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
              Answer Rate
            </span>
          </div>
          <div className="space-y-1 mt-2 flex-1 overflow-hidden">
            {bottomAnalysis.topAnswers.map((p, idx) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] items-center text-slate-300 hover:text-white cursor-pointer"
                onClick={() => setInspectedPoint(p)}
              >
                <span className="truncate pr-2 font-medium">
                  {idx + 1}. {p.label}
                </span>
                <span className="font-mono font-bold text-sky-400 shrink-0">{p.answerRate}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: Listen Quality Volumes */}
        <div className="p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
              Listen Volumes
            </span>
          </div>
          <div className="space-y-1 mt-2 flex-1 overflow-hidden">
            {bottomAnalysis.topListens.map((p, idx) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] items-center text-slate-300 hover:text-white cursor-pointer"
                onClick={() => setInspectedPoint(p)}
              >
                <span className="truncate pr-2 font-medium">
                  {idx + 1}. {p.label}
                </span>
                <span className="font-mono font-bold text-sky-300 shrink-0">
                  {p.verifiedListens}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 3: Direct Transfer Rates */}
        <div className="p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
              Transfer Rates
            </span>
          </div>
          <div className="space-y-1 mt-2 flex-1 overflow-hidden">
            {bottomAnalysis.topTransfers.map((p, idx) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] items-center text-slate-300 hover:text-white cursor-pointer"
                onClick={() => setInspectedPoint(p)}
              >
                <span className="truncate pr-2 font-medium">
                  {idx + 1}. {p.label}
                </span>
                <span className="font-mono font-bold text-emerald-400 shrink-0">
                  {p.transferRate}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 4: Revenue Movement */}
        <div className="p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <DollarSign className="h-3.5 w-3.5 text-yellow-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
              Revenue Yield
            </span>
          </div>
          <div className="space-y-1 mt-2 flex-1 overflow-hidden">
            {bottomAnalysis.topRevenue.map((p, idx) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] items-center text-slate-300 hover:text-white cursor-pointer"
                onClick={() => setInspectedPoint(p)}
              >
                <span className="truncate pr-2 font-medium">
                  {idx + 1}. {p.label}
                </span>
                <span className="font-mono font-bold text-yellow-400 shrink-0">
                  ${Math.round(p.revenueMovement)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 5: Underperforming Wasted Spend */}
        <div className="p-3.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
              Wasted Spend
            </span>
          </div>
          <div className="space-y-1 mt-2 flex-1 overflow-hidden">
            {bottomAnalysis.wastedSpend.map((p, idx) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] items-center text-slate-300 hover:text-white cursor-pointer"
                onClick={() => setInspectedPoint(p)}
              >
                <span className="truncate pr-2 font-medium">
                  {idx + 1}. {p.label}
                </span>
                <span className="font-mono font-bold text-red-400 shrink-0">
                  ${Math.round(p.spend)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
