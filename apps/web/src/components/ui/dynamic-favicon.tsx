'use client';

/**
 * Project Cortex | Dynamic Beacon Favicon
 *
 * Squircle shape in Toxic Lime (#CCFF00).
 * Pulses when activeCalls > 0.
 */

import { useEffect, useRef } from 'react';
import { useLiveCallCount } from '@/hooks/adapters';

const TOXIC_LIME = '#CCFF00';
const VOID_CHARCOAL = '#0B0D10';

function drawSquircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number
) {
  const halfSize = size / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + size - radius, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
  ctx.lineTo(x + size, y + size - radius);
  ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  ctx.lineTo(x + radius, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function DynamicFavicon() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const { count: activeCalls, isLive } = useLiveCallCount();

  useEffect(() => {
    // Create canvas if it doesn't exist
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 32;
      canvasRef.current.height = 32;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pulsePhase = 0;
    const isActive = activeCalls > 0;

    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, 32, 32);

      // Calculate pulse effect
      const pulseScale = isActive ? 0.9 + Math.sin(pulsePhase) * 0.1 : 1;
      const pulseOpacity = isActive ? 0.7 + Math.sin(pulsePhase) * 0.3 : 1;

      // Draw background squircle
      ctx.save();
      ctx.translate(16, 16);
      ctx.scale(pulseScale, pulseScale);
      ctx.translate(-16, -16);

      // Fill squircle
      ctx.fillStyle = TOXIC_LIME;
      ctx.globalAlpha = pulseOpacity;
      drawSquircle(ctx, 2, 2, 28, 8);
      ctx.fill();

      // Add glow effect if active
      if (isActive) {
        ctx.shadowColor = TOXIC_LIME;
        ctx.shadowBlur = 8;
        ctx.fill();
      }

      ctx.restore();

      // Draw "H" letter
      ctx.fillStyle = VOID_CHARCOAL;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', 16, 17);

      // Update favicon
      const link =
        document.querySelector<HTMLLinkElement>('link[rel="icon"]') ||
        document.createElement('link');
      link.rel = 'icon';
      link.href = canvas.toDataURL('image/png');
      if (!link.parentNode) {
        document.head.appendChild(link);
      }

      // Continue animation if active
      if (isActive) {
        pulsePhase += 0.15;
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [activeCalls]);

  // This component doesn't render anything visible
  return null;
}

export default DynamicFavicon;
