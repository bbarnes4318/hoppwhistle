'use client';

import { useState } from 'react';

import { defaultMusicSettings } from '@/features/music/data/demo-music-data';
import type { MusicSettings } from '@/features/music/types';

export default function MusicSettingsPage() {
  const [settings, setSettings] = useState<MusicSettings>(defaultMusicSettings);
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const u = (patch: Partial<MusicSettings>) => setSettings({ ...settings, ...patch });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Music Console Settings</h1>
        <p className="text-sm text-zinc-500">Configure AI voice engagement, compliance, and reporting</p>
      </div>

      {/* Organization */}
      <div className="rounded-lg border border-violet-500/20 bg-card/50 p-5 backdrop-blur-sm space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Organization</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Label / Organization Name</label>
            <input type="text" value={settings.organizationName} onChange={e => u({ organizationName: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Default AI Voice</label>
            <select value={settings.defaultAiVoice} onChange={e => u({ defaultAiVoice: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none">
              <option>Luna — Warm &amp; Conversational</option>
              <option>Blaze — Energetic &amp; Upbeat</option>
              <option>Aria — Smooth &amp; Soulful</option>
              <option>Nova — Professional &amp; Clear</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Timezone</label>
            <select value={settings.timezone} onChange={e => u({ timezone: e.target.value })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none">
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Compliance Mode</label>
            <select value={settings.complianceMode} onChange={e => u({ complianceMode: e.target.value as MusicSettings['complianceMode'] })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none">
              <option value="tcpa_strict">TCPA Strict (recommended)</option>
              <option value="tcpa_standard">TCPA Standard</option>
            </select>
          </div>
        </div>
      </div>

      {/* Recording & Proof */}
      <div className="rounded-lg border border-violet-500/20 bg-card/50 p-5 backdrop-blur-sm space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Recording &amp; Proof</h2>
        <div className="space-y-3">
          {([
            { label: 'Record All Fan Interactions', key: 'recordAllInteractions' as const, value: settings.recordAllInteractions },
            { label: 'Transcribe All Interactions', key: 'transcribeAllInteractions' as const, value: settings.transcribeAllInteractions },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">{item.label}</span>
              <button onClick={() => u({ [item.key]: !item.value })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item.value ? 'bg-violet-500' : 'bg-zinc-700'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${item.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
          ))}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Max Opt-Out Rate Threshold (%)</label>
            <input type="number" min={1} max={20} value={settings.optOutThreshold} onChange={e => u({ optOutThreshold: Number(e.target.value) })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-lg border border-violet-500/20 bg-card/50 p-5 backdrop-blur-sm space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Notifications &amp; Reports</h2>
        <div className="space-y-3">
          {([
            { label: 'Push Notifications', key: 'notificationsEnabled' as const, value: settings.notificationsEnabled },
            { label: 'Email Reports', key: 'emailReports' as const, value: settings.emailReports },
          ]).map(item => (
            <label key={item.key} className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">{item.label}</span>
              <button onClick={() => u({ [item.key]: !item.value })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item.value ? 'bg-violet-500' : 'bg-zinc-700'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${item.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
          ))}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Report Frequency</label>
            <select value={settings.reportFrequency} onChange={e => u({ reportFrequency: e.target.value as MusicSettings['reportFrequency'] })} className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="rounded-md bg-violet-600 px-6 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-500 active:scale-95 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-900">Save Settings</button>
        {saved && <span className="text-xs text-emerald-400 animate-pulse">✓ Settings saved</span>}
      </div>
    </div>
  );
}
