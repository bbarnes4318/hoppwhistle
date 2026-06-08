'use client';

import { Settings as SettingsIcon, Save, Building, ShieldCheck, ShieldAlert, Target, Bell, Link2, Upload } from 'lucide-react';
import { useState, useEffect } from 'react';

import { defaultMusicSettings } from '@/features/music/data/demo-music-data';
import type { MusicCampaignType } from '@/features/music/types';
import { cn } from '@/lib/utils';

export default function MusicSettingsPage() {
  const [settings, setSettings] = useState(defaultMusicSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'voice_safety' | 'compliance' | 'alerts_integrations'>('general');

  useEffect(() => {
    const saved = localStorage.getItem('musicSettings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    localStorage.setItem('musicSettings', JSON.stringify(settings));
    setTimeout(() => setIsSaving(false), 800);
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-black tracking-tight flex items-center gap-3 m-text-text uppercase">
            <SettingsIcon className="h-6 w-6 m-text-accent" /> Platform Settings
          </h1>
          <p className="mt-1.5 text-xs m-text-muted max-w-xl">
            Configure default campaign parameters, brand safety constraints, and institutional compliance protocols.
          </p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--m-accent)] text-white rounded text-xs font-bold hover:bg-[#008be5] transition-colors disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
      </header>

      {/* Tabs Navigation */}
      <div className="flex border-b border-[var(--m-border-2)] shrink-0 gap-1 bg-black/10 p-1 rounded">
        <button
          onClick={() => setActiveTab('general')}
          className={cn(
            "m-tab-btn px-4 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition-all",
            activeTab === 'general' ? "m-tab-btn--active bg-[var(--m-surface-2)] text-[var(--m-accent)] border border-[var(--m-border)]" : "text-[var(--m-muted)] hover:text-white"
          )}
        >
          General & Defaults
        </button>
        <button
          onClick={() => setActiveTab('voice_safety')}
          className={cn(
            "m-tab-btn px-4 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition-all",
            activeTab === 'voice_safety' ? "m-tab-btn--active bg-[var(--m-surface-2)] text-[var(--m-accent)] border border-[var(--m-border)]" : "text-[var(--m-muted)] hover:text-white"
          )}
        >
          Voice & Brand Safety
        </button>
        <button
          onClick={() => setActiveTab('compliance')}
          className={cn(
            "m-tab-btn px-4 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition-all",
            activeTab === 'compliance' ? "m-tab-btn--active bg-[var(--m-surface-2)] text-[var(--m-accent)] border border-[var(--m-border)]" : "text-[var(--m-muted)] hover:text-white"
          )}
        >
          Institutional Compliance
        </button>
        <button
          onClick={() => setActiveTab('alerts_integrations')}
          className={cn(
            "m-tab-btn px-4 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition-all",
            activeTab === 'alerts_integrations' ? "m-tab-btn--active bg-[var(--m-surface-2)] text-[var(--m-accent)] border border-[var(--m-border)]" : "text-[var(--m-muted)] hover:text-white"
          )}
        >
          Alerts & Integrations
        </button>
      </div>
      
      <div className="w-full">
        {/* Tab Content 1: General & Defaults */}
        {activeTab === 'general' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-fadeIn">
            <section className="m-card p-5 bg-[var(--m-surface)]">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
                <Building className="h-4.5 w-4.5 m-text-accent" /> Organization Profile
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Label / Team Name</label>
                  <input type="text" className="m-input" value={settings.organizationName} onChange={e => setSettings({...settings, organizationName: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Default Artist</label>
                  <input type="text" className="m-input" value={settings.defaultArtist} onChange={e => setSettings({...settings, defaultArtist: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Default Campaign Owner</label>
                  <input type="text" className="m-input" value={settings.defaultCampaignOwner} onChange={e => setSettings({...settings, defaultCampaignOwner: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Reporting Currency</label>
                  <select className="m-select" value={settings.reportingCurrency} onChange={e => setSettings({...settings, reportingCurrency: e.target.value})}>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="m-card p-5 bg-[var(--m-surface)]">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
                <Target className="h-4.5 w-4.5 m-text-accent" /> Fan Campaign Defaults
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Default Campaign Type</label>
                  <select className="m-select capitalize" value={settings.defaultCampaignType} onChange={e => setSettings({...settings, defaultCampaignType: e.target.value as MusicCampaignType})}>
                    <option value="album_presave">Album Pre-Save</option>
                    <option value="tour_onsale">Tour On-Sale</option>
                    <option value="merch_drop">Merch Drop</option>
                    <option value="vip_upgrade">VIP Upgrade</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Default Goal</label>
                  <input type="text" className="m-input" value={settings.defaultGoal} onChange={e => setSettings({...settings, defaultGoal: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Target CPA ($)</label>
                  <input type="number" step="0.01" className="m-input" value={settings.defaultCpaTarget} onChange={e => setSettings({...settings, defaultCpaTarget: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Attribution Window</label>
                  <select className="m-select" value={settings.defaultAttributionWindow} onChange={e => setSettings({...settings, defaultAttributionWindow: e.target.value})}>
                    <option value="24_hours">24 Hours</option>
                    <option value="7_days">7 Days</option>
                    <option value="30_days">30 Days</option>
                  </select>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Tab Content 2: Voice & Brand Safety */}
        {activeTab === 'voice_safety' && (
          <section className="m-card p-5 border-l-4 border-[var(--m-accent)] bg-[var(--m-surface)] animate-fadeIn">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
              <ShieldAlert className="h-4.5 w-4.5 m-text-accent" /> RPS Voice & Brand Safety
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Approved Voice Persona</label>
                  <select className="m-select" value={settings.approvedVoicePersona} onChange={e => setSettings({...settings, approvedVoicePersona: e.target.value})}>
                    <option value="Artist-Approved Promo">Artist-Approved Promo</option>
                    <option value="Tour Manager">Tour Manager</option>
                    <option value="Merch Concierge">Merch Concierge</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Max Call Duration (seconds)</label>
                  <input type="number" className="m-input" value={settings.maxCallDuration} onChange={e => setSettings({...settings, maxCallDuration: Number(e.target.value)})} />
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <label className="flex items-center gap-2.5 p-2 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                    <input type="checkbox" checked={settings.artistSafeMode} onChange={e => setSettings({...settings, artistSafeMode: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                    <span className="text-[11px] font-semibold">Artist-Safe Mode</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                    <input type="checkbox" checked={settings.requireScriptApproval} onChange={e => setSettings({...settings, requireScriptApproval: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                    <span className="text-[11px] font-semibold font-sans">Script Approval</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors opacity-70">
                    <input type="checkbox" checked={settings.allowFreeformAi} onChange={e => setSettings({...settings, allowFreeformAi: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                    <span className="text-[11px] font-semibold">Freeform AI Responses</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                    <input type="checkbox" checked={settings.boundedScriptMode} onChange={e => setSettings({...settings, boundedScriptMode: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                    <span className="text-[11px] font-semibold">Bounded Script Mode</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Brand Safety Rules / Prompt Restraints</label>
                <textarea 
                  rows={6}
                  className="m-textarea" 
                  value={settings.brandSafetyNotes} 
                  onChange={e => setSettings({...settings, brandSafetyNotes: e.target.value})} 
                />
              </div>
            </div>
          </section>
        )}

        {/* Tab Content 3: Compliance */}
        {activeTab === 'compliance' && (
          <section className="m-card p-5 bg-[var(--m-surface)] animate-fadeIn">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
              <ShieldCheck className="h-4.5 w-4.5 m-text-accent-2" /> Institutional Compliance & Consent
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2.5 p-2.5 border border-emerald-500/20 rounded bg-emerald-500/5 cursor-pointer">
                    <input type="checkbox" checked={settings.requireOptInConsent} onChange={e => setSettings({...settings, requireOptInConsent: e.target.checked})} className="w-3.5 h-3.5 accent-emerald-500" />
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Strict Opt-In Consent</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                    <input type="checkbox" checked={settings.consentSourceRequired} onChange={e => setSettings({...settings, consentSourceRequired: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                    <span className="text-[11px] font-semibold">Consent Source Log</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">TCPA Consent Mode</label>
                    <select className="m-select" value={settings.tcpaConsentMode} onChange={e => setSettings({...settings, tcpaConsentMode: e.target.value})}>
                      <option value="strict">Strict (Double Opt-in Required)</option>
                      <option value="standard">Standard (Single Opt-in)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Recording Disclosure</label>
                    <select className="m-select" value={settings.recordingDisclosure} onChange={e => setSettings({...settings, recordingDisclosure: e.target.value})}>
                      <option value="single_party">Single-Party Consent State Logic</option>
                      <option value="all_party">All-Party Mandatory Announcement</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Data Retention Window</label>
                    <select className="m-select" value={settings.dataRetentionWindow} onChange={e => setSettings({...settings, dataRetentionWindow: e.target.value})}>
                      <option value="30_days">30 Days</option>
                      <option value="90_days">90 Days</option>
                      <option value="1_year">1 Year</option>
                      <option value="indefinite">Indefinite</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold m-text-muted mb-1.5 uppercase tracking-wider">Opt-Out Handling</label>
                    <select className="m-select" value={settings.optOutHandling} onChange={e => setSettings({...settings, optOutHandling: e.target.value})}>
                      <option value="auto_blacklist">Automatic DNC Blacklist</option>
                      <option value="manual_review">Flag for Manual Review</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t md:border-t-0 md:border-l border-[var(--m-border-2)] md:pl-5 pt-4 md:pt-0">
                <label className="block text-xs font-bold m-text-muted mb-2 uppercase tracking-wider">Global Suppression List (DNC)</label>
                <div className="flex gap-4">
                  <div className="flex-1 border border-dashed border-[var(--m-border)] rounded bg-[var(--m-surface-2)] p-6 text-center cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                    <Upload className="h-6 w-6 mx-auto mb-2 m-text-muted" />
                    <span className="text-xs font-bold uppercase tracking-wider">Upload .CSV Suppression List</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab Content 4: Alerts & Integrations */}
        {activeTab === 'alerts_integrations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-fadeIn">
            <section className="m-card p-5 bg-[var(--m-surface)]">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
                <Bell className="h-4.5 w-4.5 m-text-accent" /> Alert Protocols
              </h2>
              <div className="space-y-2">
                <label className="flex items-center justify-between p-2.5 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                  <span className="text-xs font-semibold">Campaign Launch Alerts</span>
                  <input type="checkbox" checked={settings.alertCampaignLaunch} onChange={e => setSettings({...settings, alertCampaignLaunch: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                </label>
                <label className="flex items-center justify-between p-2.5 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                  <span className="text-xs font-semibold">CPVA Target Breached</span>
                  <input type="checkbox" checked={settings.alertCpaThreshold} onChange={e => setSettings({...settings, alertCpaThreshold: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                </label>
                <label className="flex items-center justify-between p-2.5 border border-rose-500/20 rounded bg-rose-500/5 cursor-pointer">
                  <span className="text-xs font-bold text-rose-400 uppercase tracking-wide">Opt-Out Spike Warning</span>
                  <input type="checkbox" checked={settings.alertOptOutSpike} onChange={e => setSettings({...settings, alertOptOutSpike: e.target.checked})} className="w-3.5 h-3.5 accent-rose-500" />
                </label>
                <label className="flex items-center justify-between p-2.5 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                  <span className="text-xs font-semibold">High Intent Fan Alerts</span>
                  <input type="checkbox" checked={settings.alertHighIntent} onChange={e => setSettings({...settings, alertHighIntent: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                </label>
                <label className="flex items-center justify-between p-2.5 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                  <span className="text-xs font-semibold">Weekly Executive Yield Report</span>
                  <input type="checkbox" checked={settings.weeklyExecutiveReport} onChange={e => setSettings({...settings, weeklyExecutiveReport: e.target.checked})} className="w-3.5 h-3.5 accent-[var(--m-accent)]" />
                </label>
              </div>
            </section>

            <section className="m-card p-5 bg-[var(--m-surface)]">
              <h2 className="text-sm font-bold flex items-center gap-2 mb-4 m-text-text border-b border-[var(--m-border-2)] pb-2 uppercase tracking-wider">
                <Link2 className="h-4.5 w-4.5 m-text-accent" /> Media Network Integrations
              </h2>
              <div className="space-y-2.5">
                <div className="p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">Spotify API Pre-Saves</div>
                    <div className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Connected</div>
                  </div>
                  <button className="text-[10px] font-bold border border-[var(--m-border)] px-2.5 py-1 rounded hover:bg-[var(--m-border-2)]">Configure</button>
                </div>
                <div className="p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">Ticketmaster Developer</div>
                    <div className="text-[10px] m-text-dim mt-0.5 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[var(--m-border-2)]"></div> Disconnected</div>
                  </div>
                  <button className="text-[10px] font-bold bg-white text-black px-2.5 py-1 rounded hover:bg-gray-200">Connect</button>
                </div>
                <div className="p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">Shopify Merch Sync</div>
                    <div className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Connected</div>
                  </div>
                  <button className="text-[10px] font-bold border border-[var(--m-border)] px-2.5 py-1 rounded hover:bg-[var(--m-border-2)]">Configure</button>
                </div>
                <div className="p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">RPS Live Webhooks & API</div>
                    <div className="text-[10px] m-text-dim mt-0.5 font-mono">2 Active Endpoints</div>
                  </div>
                  <button className="text-[10px] font-bold border border-[var(--m-border)] px-2.5 py-1 rounded hover:bg-[var(--m-border-2)]">Manage</button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
