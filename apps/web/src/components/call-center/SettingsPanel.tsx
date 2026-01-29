'use client';
/**
 * SettingsPanel.tsx - Carrier selection settings modal
 * Allows users to enable/disable carriers that appear in quoting
 */

import React, { useState, useEffect } from 'react';
import { Settings, X, Check, RotateCcw, Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  ALL_CARRIERS,
  CARRIER_INFO,
  getEnabledCarriers,
  setEnabledCarriers,
  enableAllCarriers,
  subscribeToSettings,
} from '../../lib/call-center/settingsService';

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [enabledCarriers, setLocalEnabledCarriers] = useState<string[]>(getEnabledCarriers());
  const [hasChanges, setHasChanges] = useState(false);

  // Subscribe to settings changes
  useEffect(() => {
    const unsubscribe = subscribeToSettings(settings => {
      setLocalEnabledCarriers(settings.enabledCarriers || [...ALL_CARRIERS]);
      setHasChanges(false);
    });

    // Load initial state
    setLocalEnabledCarriers(getEnabledCarriers());

    return () => unsubscribe();
  }, []);

  // Handle carrier toggle
  const handleToggle = (carrier: string) => {
    const isEnabled = enabledCarriers.includes(carrier);

    // Prevent disabling all carriers
    if (isEnabled && enabledCarriers.length <= 1) {
      return;
    }

    const newEnabled = isEnabled
      ? enabledCarriers.filter(c => c !== carrier)
      : [...enabledCarriers, carrier];

    setLocalEnabledCarriers(newEnabled);
    setHasChanges(true);
  };

  // Save changes
  const handleSave = () => {
    setEnabledCarriers(enabledCarriers);
    setHasChanges(false);
    onClose();
  };

  // Reset to all carriers
  const handleReset = () => {
    enableAllCarriers();
    setLocalEnabledCarriers([...ALL_CARRIERS]);
    setHasChanges(false);
  };

  // Select all
  const handleSelectAll = () => {
    setLocalEnabledCarriers([...ALL_CARRIERS]);
    setHasChanges(true);
  };

  // Deselect all (keep first one)
  const handleDeselectAll = () => {
    setLocalEnabledCarriers([ALL_CARRIERS[0]]);
    setHasChanges(true);
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-left">
            <div className="settings-icon">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2>Carrier Settings</h2>
              <p>Select which carriers appear in quoting</p>
            </div>
          </div>
          <button className="settings-close" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions Bar */}
        <div className="settings-actions">
          <div className="settings-stats">
            <span className="stat-badge">
              <CheckCircle2 className="w-4 h-4" />
              {enabledCarriers.length} of {ALL_CARRIERS.length} carriers enabled
            </span>
          </div>
          <div className="settings-buttons">
            <button className="action-btn secondary" onClick={handleSelectAll}>
              Select All
            </button>
            <button className="action-btn secondary" onClick={handleDeselectAll}>
              Deselect All
            </button>
            <button
              className="action-btn secondary"
              onClick={handleReset}
              title="Reset to defaults"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>

        {/* Carrier Grid */}
        <div className="carrier-grid">
          {ALL_CARRIERS.map(carrier => {
            const isEnabled = enabledCarriers.includes(carrier);
            const info = CARRIER_INFO[carrier] || {};
            const isLastEnabled = isEnabled && enabledCarriers.length === 1;

            return (
              <div
                key={carrier}
                className={`carrier-card ${isEnabled ? 'enabled' : 'disabled'} ${isLastEnabled ? 'locked' : ''}`}
                onClick={() => !isLastEnabled && handleToggle(carrier)}
              >
                {/* Carrier Logo */}
                <div className="carrier-logo-wrap">
                  {info.logo ? (
                    <img
                      src={info.logo}
                      alt={carrier}
                      className="carrier-logo"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const fallback = (e.target as HTMLImageElement).nextSibling as HTMLElement;
                        fallback?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <span className={`carrier-logo-fallback ${info.logo ? 'hidden' : ''}`}>
                    {carrier.substring(0, 2).toUpperCase()}
                  </span>
                </div>

                {/* Carrier Info */}
                <div className="carrier-info">
                  <h3>{carrier}</h3>
                  <div className="carrier-plans">
                    {(info.plans || []).map(plan => (
                      <span key={plan} className="plan-badge">
                        {plan}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Toggle Indicator */}
                <div className={`carrier-toggle ${isEnabled ? 'on' : 'off'}`}>
                  {isEnabled ? <Check className="w-4 h-4" /> : null}
                </div>

                {/* Lock indicator for last enabled carrier */}
                {isLastEnabled && (
                  <div className="carrier-lock">
                    <Shield className="w-3 h-3" />
                    <span>Required</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          {hasChanges && (
            <div className="unsaved-warning">
              <AlertCircle className="w-4 h-4" />
              <span>You have unsaved changes</span>
            </div>
          )}
          <div className="footer-buttons">
            <button className="action-btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className={`action-btn primary ${hasChanges ? 'pulse' : ''}`}
              onClick={handleSave}
            >
              <Check className="w-4 h-4" />
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Inline Styles */}
      <style jsx>{`
        .settings-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }

        .settings-panel {
          background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%);
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          width: 100%;
          max-width: 800px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }

        .settings-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: linear-gradient(
            90deg,
            rgba(16, 185, 129, 0.1) 0%,
            rgba(59, 130, 246, 0.1) 100%
          );
          flex-shrink: 0;
        }

        .settings-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .settings-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .settings-header h2 {
          color: white;
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0;
        }

        .settings-header p {
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.875rem;
          margin: 4px 0 0 0;
        }

        .settings-close {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .settings-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }

        .settings-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          flex-shrink: 0;
        }

        .settings-stats {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stat-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 20px;
          color: #10b981;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .settings-buttons {
          display: flex;
          gap: 8px;
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .action-btn.secondary {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
        }

        .action-btn.secondary:hover {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }

        .action-btn.primary {
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
          border: none;
          color: white;
        }

        .action-btn.primary:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .action-btn.primary.pulse {
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
          }
        }

        .carrier-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
          padding: 20px 24px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          max-height: calc(90vh - 280px);
        }

        .carrier-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .carrier-card.enabled {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .carrier-card.enabled:hover {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.5);
        }

        .carrier-card.disabled {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          opacity: 0.6;
        }

        .carrier-card.disabled:hover {
          background: rgba(255, 255, 255, 0.05);
          opacity: 0.8;
        }

        .carrier-card.locked {
          cursor: not-allowed;
        }

        .carrier-logo-wrap {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
        }

        .carrier-logo {
          width: 40px;
          height: 40px;
          object-fit: contain;
        }

        .carrier-logo-fallback {
          font-size: 1rem;
          font-weight: 700;
          color: #475569;
        }

        .carrier-logo-fallback.hidden {
          display: none;
        }

        .carrier-info {
          flex: 1;
          min-width: 0;
        }

        .carrier-info h3 {
          color: white;
          font-size: 0.95rem;
          font-weight: 600;
          margin: 0 0 6px 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .carrier-plans {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .plan-badge {
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 500;
        }

        .carrier-toggle {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .carrier-toggle.on {
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
          color: white;
        }

        .carrier-toggle.off {
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .carrier-lock {
          position: absolute;
          top: 8px;
          right: 8px;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: rgba(245, 158, 11, 0.2);
          border-radius: 6px;
          color: #f59e0b;
          font-size: 0.65rem;
          font-weight: 600;
        }

        .settings-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.2);
          flex-shrink: 0;
        }

        .unsaved-warning {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #f59e0b;
          font-size: 0.85rem;
          font-weight: 500;
        }

        .footer-buttons {
          display: flex;
          gap: 12px;
        }

        /* Responsive adjustments */
        @media (max-width: 640px) {
          .settings-panel {
            max-height: 95vh;
            border-radius: 16px;
          }

          .carrier-grid {
            grid-template-columns: 1fr;
          }

          .settings-actions {
            flex-direction: column;
            gap: 12px;
          }

          .settings-footer {
            flex-direction: column;
            gap: 12px;
          }
        }
      `}</style>
    </div>
  );
}
