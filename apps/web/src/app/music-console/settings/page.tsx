'use client';

import { useState } from 'react';
import { Settings as SettingsIcon, Save, Building, ShieldCheck, ShieldAlert, Target, Bell, Link2, Upload } from 'lucide-react';
import { defaultMusicSettings } from '@/features/music/data/demo-music-data';

export default function MusicSettingsPage() {
  const [settings, setSettings] = useState(defaultMusicSettings);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => setIsSaving(false), 800);
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="border-b border-[var(--m-border-2)] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight flex items-center gap-3 m-text-text">
            <SettingsIcon className="h-7 w-7 m-text-accent" /> Platform Settings
          </h1>
          <p className="mt-2 text-sm m-text-muted max-w-xl">
            Configure default campaign parameters, brand safety constraints, and institutional compliance protocols.
          </p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-2.5 bg-[var(--m-accent)] text-white rounded-md text-sm font-semibold hover:bg-violet-600 transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
      </header>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* A. Organization */}
          <section className="m-card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <Building className="h-5 w-5 m-text-accent" /> Organization Profile
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Label / Team Name</label>
                <input type="text" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.organizationName} onChange={e => setSettings({...settings, organizationName: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Default Artist</label>
                <input type="text" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.defaultArtist} onChange={e => setSettings({...settings, defaultArtist: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Default Campaign Owner</label>
                <input type="text" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.defaultCampaignOwner} onChange={e => setSettings({...settings, defaultCampaignOwner: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Reporting Currency</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.reportingCurrency} onChange={e => setSettings({...settings, reportingCurrency: e.target.value})}>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
            </div>
          </section>

          {/* B. Voice & Brand Safety */}
          <section className="m-card p-6 border-l-4 border-[var(--m-accent)]">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <ShieldAlert className="h-5 w-5 m-text-accent" /> Voice & Brand Safety
            </h2>
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold m-text-muted mb-2">Approved Voice Persona</label>
                  <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.approvedVoicePersona} onChange={e => setSettings({...settings, approvedVoicePersona: e.target.value})}>
                    <option value="Artist-Approved Promo">Artist-Approved Promo</option>
                    <option value="Tour Manager">Tour Manager</option>
                    <option value="Merch Concierge">Merch Concierge</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold m-text-muted mb-2">Max Call Duration (seconds)</label>
                  <input type="number" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.maxCallDuration} onChange={e => setSettings({...settings, maxCallDuration: Number(e.target.value)})} />
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                  <input type="checkbox" checked={settings.artistSafeMode} onChange={e => setSettings({...settings, artistSafeMode: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
                  <span className="text-sm font-medium">Artist-Safe Mode</span>
                </label>
                <label className="flex items-center gap-3 p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                  <input type="checkbox" checked={settings.requireScriptApproval} onChange={e => setSettings({...settings, requireScriptApproval: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
                  <span className="text-sm font-medium">Require Script Approval</span>
                </label>
                <label className="flex items-center gap-3 p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors opacity-70">
                  <input type="checkbox" checked={settings.allowFreeformAi} onChange={e => setSettings({...settings, allowFreeformAi: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
                  <span className="text-sm font-medium">Allow Freeform AI Responses</span>
                </label>
                <label className="flex items-center gap-3 p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                  <input type="checkbox" checked={settings.boundedScriptMode} onChange={e => setSettings({...settings, boundedScriptMode: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
                  <span className="text-sm font-medium">Bounded Script Mode</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Brand Safety Notes / Hard Restrictions</label>
                <textarea 
                  rows={3}
                  className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text focus:border-[var(--m-accent)] focus:outline-none" 
                  value={settings.brandSafetyNotes} 
                  onChange={e => setSettings({...settings, brandSafetyNotes: e.target.value})} 
                />
              </div>
            </div>
          </section>

          {/* C. Compliance */}
          <section className="m-card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <ShieldCheck className="h-5 w-5 m-text-accent" /> Institutional Compliance
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <label className="flex items-center gap-3 p-3 border border-emerald-500/20 rounded bg-emerald-500/5 cursor-pointer">
                <input type="checkbox" checked={settings.requireOptInConsent} onChange={e => setSettings({...settings, requireOptInConsent: e.target.checked})} className="w-4 h-4 accent-emerald-500" />
                <span className="text-sm font-medium text-emerald-400">Require Strict Opt-In Consent</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                <input type="checkbox" checked={settings.consentSourceRequired} onChange={e => setSettings({...settings, consentSourceRequired: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
                <span className="text-sm font-medium">Enforce Consent Source Log</span>
              </label>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">TCPA Consent Mode</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.tcpaConsentMode} onChange={e => setSettings({...settings, tcpaConsentMode: e.target.value})}>
                  <option value="strict">Strict (Double Opt-in Required)</option>
                  <option value="standard">Standard (Single Opt-in)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Recording Disclosure</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.recordingDisclosure} onChange={e => setSettings({...settings, recordingDisclosure: e.target.value})}>
                  <option value="single_party">Single-Party Consent State Logic</option>
                  <option value="all_party">All-Party Mandatory Announcement</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Data Retention Window</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.dataRetentionWindow} onChange={e => setSettings({...settings, dataRetentionWindow: e.target.value})}>
                  <option value="30_days">30 Days</option>
                  <option value="90_days">90 Days</option>
                  <option value="1_year">1 Year</option>
                  <option value="indefinite">Indefinite</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Opt-Out Handling</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.optOutHandling} onChange={e => setSettings({...settings, optOutHandling: e.target.value})}>
                  <option value="auto_blacklist">Automatic DNC Blacklist</option>
                  <option value="manual_review">Flag for Manual Review</option>
                </select>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-[var(--m-border-2)]">
              <label className="block text-sm font-semibold m-text-muted mb-2">Global Suppression List (DNC)</label>
              <div className="flex gap-4">
                <div className="flex-1 border border-dashed border-[var(--m-border)] rounded bg-[var(--m-surface-2)] p-4 text-center cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
                  <Upload className="h-5 w-5 mx-auto mb-2 m-text-muted" />
                  <span className="text-sm font-medium">Upload .CSV Suppression List</span>
                </div>
              </div>
            </div>
          </section>

          {/* D. Campaign Defaults */}
          <section className="m-card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <Target className="h-5 w-5 m-text-accent" /> Campaign Defaults
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Default Campaign Type</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text capitalize" value={settings.defaultCampaignType} onChange={e => setSettings({...settings, defaultCampaignType: e.target.value as any})}>
                  <option value="album_presave">Album Pre-Save</option>
                  <option value="tour_onsale">Tour On-Sale</option>
                  <option value="merch_drop">Merch Drop</option>
                  <option value="vip_upgrade">VIP Upgrade</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Default Goal</label>
                <input type="text" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.defaultGoal} onChange={e => setSettings({...settings, defaultGoal: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Target CPA ($)</label>
                <input type="number" step="0.01" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.defaultCpaTarget} onChange={e => setSettings({...settings, defaultCpaTarget: parseFloat(e.target.value)})} />
              </div>
              <div>
                <label className="block text-sm font-semibold m-text-muted mb-2">Attribution Window</label>
                <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded p-2.5 text-sm m-text-text" value={settings.defaultAttributionWindow} onChange={e => setSettings({...settings, defaultAttributionWindow: e.target.value})}>
                  <option value="24_hours">24 Hours</option>
                  <option value="7_days">7 Days</option>
                  <option value="30_days">30 Days</option>
                </select>
              </div>
            </div>
          </section>

        </div>

        {/* Sidebar panels */}
        <div className="space-y-8">
          {/* E. Notifications */}
          <section className="m-card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <Bell className="h-5 w-5 m-text-accent" /> Alert Protocols
            </h2>
            <div className="space-y-4">
              <label className="flex items-center justify-between p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                <span className="text-sm font-medium">Campaign Launch</span>
                <input type="checkbox" checked={settings.alertCampaignLaunch} onChange={e => setSettings({...settings, alertCampaignLaunch: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
              </label>
              <label className="flex items-center justify-between p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                <span className="text-sm font-medium">CPA Target Breached</span>
                <input type="checkbox" checked={settings.alertCpaThreshold} onChange={e => setSettings({...settings, alertCpaThreshold: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
              </label>
              <label className="flex items-center justify-between p-3 border border-rose-500/20 rounded bg-rose-500/5 cursor-pointer">
                <span className="text-sm font-medium text-rose-400">Opt-Out Spike Warning</span>
                <input type="checkbox" checked={settings.alertOptOutSpike} onChange={e => setSettings({...settings, alertOptOutSpike: e.target.checked})} className="w-4 h-4 accent-rose-500" />
              </label>
              <label className="flex items-center justify-between p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                <span className="text-sm font-medium">High Intent Fan Alert</span>
                <input type="checkbox" checked={settings.alertHighIntent} onChange={e => setSettings({...settings, alertHighIntent: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
              </label>
              <label className="flex items-center justify-between p-3 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] cursor-pointer">
                <span className="text-sm font-medium">Weekly Executive Report</span>
                <input type="checkbox" checked={settings.weeklyExecutiveReport} onChange={e => setSettings({...settings, weeklyExecutiveReport: e.target.checked})} className="w-4 h-4 accent-[var(--m-accent)]" />
              </label>
            </div>
          </section>

          {/* F. Integrations */}
          <section className="m-card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 m-text-text border-b border-[var(--m-border-2)] pb-3">
              <Link2 className="h-5 w-5 m-text-accent" /> Native Integrations
            </h2>
            <div className="space-y-4">
              <div className="p-4 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Spotify Pre-Saves</div>
                  <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400"></div> Connected</div>
                </div>
                <button className="text-xs border border-[var(--m-border)] px-3 py-1.5 rounded hover:bg-[var(--m-border-2)]">Manage</button>
              </div>
              <div className="p-4 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Ticketmaster</div>
                  <div className="text-xs m-text-dim mt-1 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[var(--m-border-2)]"></div> Disconnected</div>
                </div>
                <button className="text-xs bg-white text-black font-semibold px-3 py-1.5 rounded hover:bg-gray-200">Connect</button>
              </div>
              <div className="p-4 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Shopify Merch</div>
                  <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400"></div> Connected</div>
                </div>
                <button className="text-xs border border-[var(--m-border)] px-3 py-1.5 rounded hover:bg-[var(--m-border-2)]">Manage</button>
              </div>
              <div className="p-4 border border-[var(--m-border)] rounded bg-[var(--m-surface-2)] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Webhooks & API</div>
                  <div className="text-xs m-text-dim mt-1 font-mono">2 Active Endpoints</div>
                </div>
                <button className="text-xs border border-[var(--m-border)] px-3 py-1.5 rounded hover:bg-[var(--m-border-2)]">Configure</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
