/**
 * Screenshot/Export utilities for marketing materials
 */

import html2canvas from 'html2canvas';

export interface ScreenshotOptions {
  element?: HTMLElement;
  filename?: string;
  format?: 'png' | 'jpg';
  quality?: number;
  backgroundColor?: string;
  scale?: number;
}

/**
 * Capture screenshot of an element or the entire page
 */
export async function captureScreenshot(options: ScreenshotOptions = {}): Promise<string> {
  const {
    element,
    format = 'png',
    quality = 1,
    backgroundColor = '#ffffff',
    scale = 2,
  } = options;

  const targetElement = element || document.body;

  // Ensure element is ready
  if (!targetElement || !targetElement.parentNode) {
    throw new Error('Target element is not available or not attached to DOM');
  }

  const canvas = await html2canvas(targetElement, {
    backgroundColor,
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    windowWidth: targetElement.scrollWidth,
    windowHeight: targetElement.scrollHeight,
    ignoreElements: (el) => {
      // Ignore elements that might interfere with capture
      // Skip if it's a hidden image or logo that shouldn't be in the screenshot
      if (el.tagName === 'IMG' && (el as HTMLImageElement).src.includes('logo')) {
        return false; // Actually include logos, but this can be customized
      }
      return false;
    },
  });

  // Verify canvas has content
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error('Screenshot resulted in empty canvas. Element may not be visible.');
  }

  return canvas.toDataURL(`image/${format}`, quality);
}

/**
 * Download screenshot as file
 */
export function downloadScreenshot(
  dataUrl: string,
  filename: string = `screenshot-${Date.now()}.png`
): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export dashboard as PNG
 */
export async function exportDashboard(
  elementId: string = 'dashboard',
  filename?: string
): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) {
    // Try to find the element by class or other means
    const fallback = document.querySelector('[data-dashboard]') || document.querySelector('main');
    if (!fallback) {
      throw new Error(`Element with id "${elementId}" not found and no fallback element available`);
    }
    console.warn(`Element "${elementId}" not found, using fallback element`);
    const dataUrl = await captureScreenshot({
      element: fallback as HTMLElement,
      format: 'png',
      quality: 1,
      scale: 2,
    });
    downloadScreenshot(dataUrl, filename || `dashboard-${Date.now()}.png`);
    return;
  }

  // Ensure element is visible and has content
  if (element.offsetWidth === 0 || element.offsetHeight === 0) {
    throw new Error(`Element with id "${elementId}" has zero dimensions. Make sure it's visible.`);
  }

  const dataUrl = await captureScreenshot({
    element,
    format: 'png',
    quality: 1,
    scale: 2,
  });

  downloadScreenshot(dataUrl, filename || `dashboard-${Date.now()}.png`);
}

/**
 * Export chart as PNG
 */
export async function exportChart(
  chartElement: HTMLElement,
  filename?: string
): Promise<void> {
  const dataUrl = await captureScreenshot({
    element: chartElement,
    format: 'png',
    quality: 1,
    scale: 2,
    backgroundColor: '#ffffff',
  });

  downloadScreenshot(dataUrl, filename || `chart-${Date.now()}.png`);
}

/**
 * Export multiple elements as a combined image
 */
export async function exportCombined(
  elementIds: string[],
  filename?: string
): Promise<void> {
  const elements = elementIds
    .map(id => document.getElementById(id))
    .filter(Boolean) as HTMLElement[];

  if (elements.length === 0) {
    throw new Error('No valid elements found');
  }

  // Create a container to hold all elements
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.width = `${Math.max(...elements.map(el => el.scrollWidth))}px`;
  
  let totalHeight = 0;
  elements.forEach((el, index) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.marginBottom = index < elements.length - 1 ? '20px' : '0';
    container.appendChild(clone);
    totalHeight += el.scrollHeight + (index < elements.length - 1 ? 20 : 0);
  });
  
  container.style.height = `${totalHeight}px`;
  document.body.appendChild(container);

  try {
    const dataUrl = await captureScreenshot({
      element: container,
      format: 'png',
      quality: 1,
      scale: 2,
    });

    downloadScreenshot(dataUrl, filename || `combined-${Date.now()}.png`);
  } finally {
    document.body.removeChild(container);
  }
}

