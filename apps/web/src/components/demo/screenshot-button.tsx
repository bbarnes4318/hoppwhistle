'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Download, Loader2 } from 'lucide-react';
import { exportDashboard, exportChart, captureScreenshot, downloadScreenshot } from '@/lib/screenshot';

interface ScreenshotButtonProps {
  elementId?: string;
  element?: HTMLElement;
  filename?: string;
  variant?: 'default' | 'outline' | 'ghost';
}

export function ScreenshotButton({
  elementId,
  element,
  filename,
  variant = 'outline',
}: ScreenshotButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (type: 'dashboard' | 'chart' | 'custom') => {
    setExporting(true);
    try {
      if (type === 'dashboard' && elementId) {
        // Wait a bit to ensure DOM is ready
        await new Promise(resolve => setTimeout(resolve, 100));
        await exportDashboard(elementId, filename);
      } else if (type === 'chart' && element) {
        await exportChart(element, filename);
      } else if (element) {
        const dataUrl = await captureScreenshot({ element });
        downloadScreenshot(dataUrl, filename || `screenshot-${Date.now()}.png`);
      } else {
        throw new Error('No element or elementId provided');
      }
    } catch (error) {
      console.error('Failed to export screenshot:', error);
      alert(`Failed to export screenshot: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
    } finally {
      setExporting(false);
    }
  };

  if (elementId || element) {
    return (
      <Button variant={variant} disabled={exporting} size="sm" onClick={() => {
        if (elementId) handleExport('dashboard');
        else if (element) handleExport('chart');
      }}>
        {exporting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Exporting...
          </>
        ) : (
          <>
            <Camera className="mr-2 h-4 w-4" />
            Export
          </>
        )}
      </Button>
    );
  }

  return (
    <Button variant={variant} disabled={exporting} size="sm" onClick={() => handleExport('dashboard')}>
      {exporting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <Camera className="mr-2 h-4 w-4" />
          Export Screenshot
        </>
      )}
    </Button>
  );
}

