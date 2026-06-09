'use client';

import {
  Settings as SettingsIcon,
  Save,
  Building,
  ShieldCheck,
  ShieldAlert,
  Target,
  FileText,
  Link2,
  Upload,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { defaultMusicSettings } from '../../../features/music/data/demo-music-data';
import type { MusicCampaignType } from '../../../features/music/types';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// ─── Extended Music Settings Type Definition ─────────────────
interface ExtendedMusicSettings {
  organizationName: string;
  defaultAiVoice: string;
  timezone: string;
  complianceMode: 'tcpa_strict' | 'tcpa_standard';
  recordAllInteractions: boolean;
  transcribeAllInteractions: boolean;
  optOutThreshold: number;
  notificationsEnabled: boolean;
  emailReports: boolean;
  reportFrequency: 'daily' | 'weekly' | 'monthly';
  
  defaultArtist: string;
  defaultCampaignOwner: string;
  reportingCurrency: string;
  approvedVoicePersona: string;
  artistSafeMode: boolean;
  requireScriptApproval: boolean;
  allowFreeformAi: boolean;
  boundedScriptMode: boolean;
  maxCallDuration: number;
  brandSafetyNotes: string;
  requireOptInConsent: boolean;
  consentSourceRequired: boolean;
  optOutHandling: string;
  recordingDisclosure: string;
  tcpaConsentMode: string;
  dataRetentionWindow: string;
  defaultCampaignType: MusicCampaignType;
  defaultGoal: string;
  defaultCpaTarget: number;
  defaultAttributionWindow: string;
  alertCampaignLaunch: boolean;
  alertCpaThreshold: boolean;
  alertOptOutSpike: boolean;
  alertHighIntent: boolean;
  weeklyExecutiveReport: boolean;

  // Extended fields for RPS Operator Console
  organizationDivision?: string;
  prohibitedPhrases?: string;
  defaultStationRouting?: string;
  defaultMarketTargeting?: string;
  defaultProofRequirements?: string;
  sponsorReadyReportMode?: boolean;
  autoGenerateArtistSummaries?: boolean;
  exportDefaults?: string;
  dspDestinationLinks?: string;
  crmAudienceSources?: string;
  dataWarehouseExport?: string;
}

export default function MusicSettingsPage() {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'organization' | 'voice_safety' | 'compliance' | 'campaign_defaults' | 'reporting' | 'integrations'
  >('organization');

  const [settings, setSettings] = useState<ExtendedMusicSettings>({
    ...defaultMusicSettings,
    organizationDivision: 'RPS Media Network',
    prohibitedPhrases: 'competitor links, direct marketing, unapproved pricing, vendor names',
    defaultStationRouting: 'rotation',
    defaultMarketTargeting: 'Austin, Nashville, Los Angeles',
    defaultProofRequirements: 'audio_transcript',
    sponsorReadyReportMode: true,
    autoGenerateArtistSummaries: true,
    exportDefaults: 'pdf_csv',
    dspDestinationLinks: 'https://dsp.gateway.rps/nona-ray',
    crmAudienceSources: 'https://audience.crm.rps/sync-leads',
    dataWarehouseExport: 'secure-export://RPS-Analytics-Warehouse',
  });

  useEffect(() => {
    const saved = localStorage.getItem('musicSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.warn('Failed to parse saved settings', e);
      }
    }
  }, []);

  const handleUpdate = (key: keyof ExtendedMusicSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = () => {
    setIsSaving(true);
    localStorage.setItem('musicSettings', JSON.stringify(settings));
    setTimeout(() => {
      setIsSaving(false);
      setIsDirty(false);
      toast({
        title: 'Settings Saved',
        description: 'RPS Platform configurations updated successfully.',
      });
    }, 800);
  };

  const tabs = [
    { id: 'organization', label: 'Organization', icon: Building },
    { id: 'voice_safety', label: 'Voice & Brand Safety', icon: ShieldAlert },
    { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
    { id: 'campaign_defaults', label: 'Campaign Defaults', icon: Target },
    { id: 'reporting', label: 'Reporting', icon: FileText },
    { id: 'integrations', label: 'Integrations', icon: Link2 },
  ] as const;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--m-border-2)] pb-2 mb-1.5">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 m-text-text uppercase">
            <SettingsIcon className="h-4.5 w-4.5 m-text-accent" /> RPS Platform Settings
          </h1>
          <p className="text-[10px] m-text-muted mt-0.5">
            Configure station identity, voice controls, compliance rules, campaign defaults, reporting, and provider sync.
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {isDirty ? (
            <span className="px-2 py-0.5 rounded text-[8px] font-extrabold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-xs animate-pulse">
              Local Draft
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[8px] font-extrabold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-xs">
              Saved
            </span>
          )}

          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--m-accent)] text-white rounded text-[10px] font-extrabold hover:bg-[#008be5] transition-colors disabled:opacity-40"
          >
            <Save className="h-3 w-3" />
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Two-Pane Layout */}
      <div className="flex flex-col lg:flex-row gap-3 min-h-0 h-[460px]">
        {/* Left: Tab selection */}
        <div className="w-full lg:w-52 shrink-0 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded p-2 flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded font-black text-[9px] uppercase tracking-wider transition-all text-left border shrink-0 lg:shrink-1",
                activeTab === tab.id 
                  ? "bg-[var(--m-surface)] text-[var(--m-accent)] border-[var(--m-border)] shadow-xs" 
                  : "text-zinc-500 hover:text-white border-transparent hover:bg-white/[0.02]"
              )}
            >
              <tab.icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Right: Tab content forms scrollable */}
        <div className="flex-1 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded p-4 overflow-y-auto min-h-0">
          
          {/* Tab 1: Organization */}
          {activeTab === 'organization' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <Building className="h-4 w-4 text-[var(--m-accent)]" /> Organization Profile
              </h2>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Label / Team Name</label>
                  <input 
                    type="text" 
                    className="m-input text-xs" 
                    value={settings.organizationName} 
                    onChange={e => handleUpdate('organizationName', e.target.value)} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">RPS Platform Division</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.organizationDivision} 
                    onChange={e => handleUpdate('organizationDivision', e.target.value)}
                  >
                    <option value="RPS Records">RPS Records</option>
                    <option value="RPS Media Network">RPS Media Network</option>
                    <option value="RPS Live">RPS Live</option>
                    <option value="RPS Analytics">RPS Analytics</option>
                    <option value="RPS Studios">RPS Studios</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Artist</label>
                  <input 
                    type="text" 
                    className="m-input text-xs" 
                    value={settings.defaultArtist} 
                    onChange={e => handleUpdate('defaultArtist', e.target.value)} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Campaign Owner</label>
                  <input 
                    type="text" 
                    className="m-input text-xs" 
                    value={settings.defaultCampaignOwner} 
                    onChange={e => handleUpdate('defaultCampaignOwner', e.target.value)} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Reporting Currency</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.reportingCurrency} 
                    onChange={e => handleUpdate('reportingCurrency', e.target.value)}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Platform Timezone</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.timezone} 
                    onChange={e => handleUpdate('timezone', e.target.value)}
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="UTC">Coordinated Universal Time (UTC)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Voice & Brand Safety */}
          {activeTab === 'voice_safety' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-[var(--m-accent)]" /> Voice & Brand Safety
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Approved Voice Persona</label>
                    <select 
                      className="m-select text-xs" 
                      value={settings.approvedVoicePersona} 
                      onChange={e => handleUpdate('approvedVoicePersona', e.target.value)}
                    >
                      <option value="Artist-Approved Promo">Artist-Approved Promo (Sarah - Studio Voice)</option>
                      <option value="Tour Manager">Tour Manager (Marcus - Studio Voice)</option>
                      <option value="Merch Concierge">Merch Concierge (Brian - Studio Voice)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Max Interaction Length (seconds)</label>
                    <input 
                      type="number" 
                      className="m-input text-xs" 
                      value={settings.maxCallDuration} 
                      onChange={e => handleUpdate('maxCallDuration', Number(e.target.value))} 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1.5">
                    <label className="flex items-center gap-2 p-1.5 border border-white/5 rounded bg-black/10 cursor-pointer hover:bg-black/20 transition-all text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.artistSafeMode} 
                        onChange={e => handleUpdate('artistSafeMode', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                      />
                      <span>Artist-Safe Mode</span>
                    </label>

                    <label className="flex items-center gap-2 p-1.5 border border-white/5 rounded bg-black/10 cursor-pointer hover:bg-black/20 transition-all text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.requireScriptApproval} 
                        onChange={e => handleUpdate('requireScriptApproval', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                      />
                      <span>Require Script Approval</span>
                    </label>

                    <label className="flex items-center gap-2 p-1.5 border border-white/5 rounded bg-black/10 cursor-pointer hover:bg-black/20 transition-all text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.boundedScriptMode} 
                        onChange={e => handleUpdate('boundedScriptMode', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                      />
                      <span>Bounded Script Mode</span>
                    </label>

                    <label className="flex items-center gap-2 p-1.5 border border-white/5 rounded bg-black/10 cursor-pointer hover:bg-black/20 transition-all text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.allowFreeformAi} 
                        onChange={e => handleUpdate('allowFreeformAi', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                      />
                      <span>Allow Freeform AI</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Brand Safety Rules / Prompts</label>
                    <textarea 
                      rows={3}
                      className="m-textarea text-xs" 
                      value={settings.brandSafetyNotes} 
                      onChange={e => handleUpdate('brandSafetyNotes', e.target.value)} 
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Prohibited Broadcast Phrases</label>
                    <textarea 
                      rows={2}
                      className="m-textarea text-xs" 
                      value={settings.prohibitedPhrases} 
                      onChange={e => handleUpdate('prohibitedPhrases', e.target.value)} 
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Compliance */}
          {activeTab === 'compliance' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[var(--m-accent-2)]" /> Compliance & Consent
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2 border border-emerald-500/20 rounded bg-emerald-500/5 cursor-pointer text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.requireOptInConsent} 
                        onChange={e => handleUpdate('requireOptInConsent', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-emerald-500 rounded border-emerald-500/20 bg-black" 
                      />
                      <span className="font-bold text-emerald-400">Strict Opt-In Consent</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 border border-white/5 rounded bg-black/10 cursor-pointer text-[10px]">
                      <input 
                        type="checkbox" 
                        checked={settings.consentSourceRequired} 
                        onChange={e => handleUpdate('consentSourceRequired', e.target.checked)} 
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                      />
                      <span>Enforce Consent Log</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">TCPA Consent Mode</label>
                      <select 
                        className="m-select text-xs" 
                        value={settings.tcpaConsentMode} 
                        onChange={e => handleUpdate('tcpaConsentMode', e.target.value)}
                      >
                        <option value="strict">Strict (Double Opt-In)</option>
                        <option value="standard">Standard (Single Opt-In)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Recording Disclosure</label>
                      <select 
                        className="m-select text-xs" 
                        value={settings.recordingDisclosure} 
                        onChange={e => handleUpdate('recordingDisclosure', e.target.value)}
                      >
                        <option value="single_party">Single-Party Consent State</option>
                        <option value="all_party">All-Party Mandatory Announcement</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Data Retention Window</label>
                      <select 
                        className="m-select text-xs" 
                        value={settings.dataRetentionWindow} 
                        onChange={e => handleUpdate('dataRetentionWindow', e.target.value)}
                      >
                        <option value="30_days">30 Days</option>
                        <option value="90_days">90 Days</option>
                        <option value="1_year">1 Year</option>
                        <option value="indefinite">Indefinite</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Opt-Out Handling</label>
                      <select 
                        className="m-select text-xs" 
                        value={settings.optOutHandling} 
                        onChange={e => handleUpdate('optOutHandling', e.target.value)}
                      >
                        <option value="auto_blacklist">Auto-Suppression DNC</option>
                        <option value="manual_review">Manual operator review</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Global Suppression CSV Upload</label>
                    <div className="border border-dashed border-white/10 rounded bg-black/25 p-5 text-center cursor-pointer hover:bg-black/40 hover:border-[var(--m-accent)]/50 transition-all">
                      <Upload className="h-5 w-5 mx-auto mb-1 text-slate-500 animate-pulse" />
                      <span className="block text-[10px] font-bold text-slate-400">Load Suppression List (.CSV)</span>
                      <span className="block text-[8px] text-slate-600 mt-0.5">Mutes specific DIDs globally across active campaigns</span>
                    </div>
                  </div>

                  <div className="bg-black/10 rounded p-2 border border-white/5 space-y-1">
                    <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-1">Suppression Checklist</span>
                    <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>TCPA opt-in check verified</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>Audio disclosure check configured</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>Compliance suppression lists loaded</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Campaign Defaults */}
          {activeTab === 'campaign_defaults' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <Target className="h-4 w-4 text-[var(--m-accent)]" /> Campaign Defaults
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Campaign Type</label>
                  <select 
                    className="m-select text-xs capitalize" 
                    value={settings.defaultCampaignType} 
                    onChange={e => handleUpdate('defaultCampaignType', e.target.value as MusicCampaignType)}
                  >
                    <option value="album_presave">Album Pre-Save</option>
                    <option value="tour_onsale">Tour On-Sale</option>
                    <option value="merch_drop">Merch Drop</option>
                    <option value="vip_upgrade">VIP Upgrade</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Campaign Goal</label>
                  <input 
                    type="text" 
                    className="m-input text-xs" 
                    value={settings.defaultGoal} 
                    onChange={e => handleUpdate('defaultGoal', e.target.value)} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Audience Segment</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.defaultCampaignType === 'album_presave' ? 'stream_save' : 'superfan'} 
                    onChange={() => {}}
                  >
                    <option value="superfan">Superfans</option>
                    <option value="stream_save">Stream Savers</option>
                    <option value="vip_list">VIP Upgrade List</option>
                    <option value="tour_city">Tour City Fans</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Station Outbound Route</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.defaultStationRouting} 
                    onChange={e => handleUpdate('defaultStationRouting', e.target.value)}
                  >
                    <option value="primary">Primary Line Pool</option>
                    <option value="backup">Backup Line Pool</option>
                    <option value="rotation">Full Rotation Pool</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Target CPA ($)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="m-input text-xs" 
                    value={settings.defaultCpaTarget} 
                    onChange={e => handleUpdate('defaultCpaTarget', parseFloat(e.target.value))} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Attribution Window</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.defaultAttributionWindow} 
                    onChange={e => handleUpdate('defaultAttributionWindow', e.target.value)}
                  >
                    <option value="24_hours">24 Hours</option>
                    <option value="7_days">7 Days</option>
                    <option value="30_days">30 Days</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Market Plays</label>
                  <input 
                    type="text" 
                    className="m-input text-xs" 
                    value={settings.defaultMarketTargeting} 
                    onChange={e => handleUpdate('defaultMarketTargeting', e.target.value)} 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Default Proof Requirements</label>
                  <select 
                    className="m-select text-xs" 
                    value={settings.defaultProofRequirements} 
                    onChange={e => handleUpdate('defaultProofRequirements', e.target.value)}
                  >
                    <option value="audio_transcript">Audio + Verbatim Transcript</option>
                    <option value="audio">Audio Capture Only</option>
                    <option value="transcript">Transcript Only</option>
                    <option value="metadata">Attribution Metadata Only</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Tab 5: Reporting */}
          {activeTab === 'reporting' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-[var(--m-accent)]" /> Platform Reporting Defaults
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="flex items-center justify-between p-2 border border-white/5 rounded bg-black/10 cursor-pointer text-xs font-semibold">
                    <span>Email Automated Reports</span>
                    <input 
                      type="checkbox" 
                      checked={settings.emailReports} 
                      onChange={e => handleUpdate('emailReports', e.target.checked)} 
                      className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 border border-white/5 rounded bg-black/10 cursor-pointer text-xs font-semibold">
                    <span>Sponsor-Ready Report Mode</span>
                    <input 
                      type="checkbox" 
                      checked={settings.sponsorReadyReportMode} 
                      onChange={e => handleUpdate('sponsorReadyReportMode', e.target.checked)} 
                      className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 border border-white/5 rounded bg-black/10 cursor-pointer text-xs font-semibold">
                    <span>Auto-Generate Artist Summaries</span>
                    <input 
                      type="checkbox" 
                      checked={settings.autoGenerateArtistSummaries} 
                      onChange={e => handleUpdate('autoGenerateArtistSummaries', e.target.checked)} 
                      className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black" 
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Report Compilation Frequency</label>
                    <select 
                      className="m-select text-xs" 
                      value={settings.reportFrequency} 
                      onChange={e => handleUpdate('reportFrequency', e.target.value)}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Export Format Defaults</label>
                    <select 
                      className="m-select text-xs" 
                      value={settings.exportDefaults} 
                      onChange={e => handleUpdate('exportDefaults', e.target.value)}
                    >
                      <option value="pdf_csv">PDF Summary + CSV Proof Logs</option>
                      <option value="pdf">PDF Summary Only</option>
                      <option value="csv">CSV Logs Only</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 6: Integrations */}
          {activeTab === 'integrations' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-[var(--m-border-2)] pb-1.5 flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-[var(--m-accent)]" /> Platform Integrations
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">DSP Target Destination link</label>
                    <input 
                      type="text" 
                      className="m-input text-xs font-mono" 
                      value={settings.dspDestinationLinks} 
                      onChange={e => handleUpdate('dspDestinationLinks', e.target.value)} 
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">CRM / Audience Sync Endpoint</label>
                    <input 
                      type="text" 
                      className="m-input text-xs font-mono" 
                      value={settings.crmAudienceSources} 
                      onChange={e => handleUpdate('crmAudienceSources', e.target.value)} 
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold m-text-muted mb-1 uppercase tracking-wider">Data Warehouse Export Link</label>
                    <input 
                      type="text" 
                      className="m-input text-xs font-mono" 
                      value={settings.dataWarehouseExport} 
                      onChange={e => handleUpdate('dataWarehouseExport', e.target.value)} 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="block text-[9px] font-bold m-text-muted uppercase tracking-wider mb-1">Dynamic API Gateway Feeds</span>
                  
                  <div className="p-2.5 border border-white/5 rounded bg-black/15 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-white text-[11px]">Artist Stream DSP Gateway</div>
                      <div className="text-[8px] text-emerald-400 mt-0.5 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Connected</div>
                    </div>
                    <button className="text-[9px] font-bold border border-white/10 px-2 py-0.5 rounded hover:bg-white/5 text-zinc-300">Configure</button>
                  </div>
                  
                  <div className="p-2.5 border border-white/5 rounded bg-black/15 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-white text-[11px]">Audience Ticketing Webhook</div>
                      <div className="text-[8px] text-zinc-500 mt-0.5 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-zinc-650" /> Disconnected</div>
                    </div>
                    <button className="text-[9px] font-bold bg-white text-black px-2.5 py-0.5 rounded hover:bg-gray-200">Connect</button>
                  </div>
                  
                  <div className="p-2.5 border border-white/5 rounded bg-black/15 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-white text-[11px]">E-Commerce Monetization Sync</div>
                      <div className="text-[8px] text-emerald-400 mt-0.5 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Connected</div>
                    </div>
                    <button className="text-[9px] font-bold border border-white/10 px-2 py-0.5 rounded hover:bg-white/5 text-zinc-300">Configure</button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
