/**
 * Backend availability checker
 * Prevents WebSocket connections when backend is not available
 */

let backendAvailable: boolean | null = null;
let lastCheck = 0;
const CHECK_INTERVAL = 60000; // Check once per minute
const CACHE_DURATION = 30000; // Cache result for 30 seconds

export async function isBackendAvailable(baseUrl: string = 'http://localhost:3001'): Promise<boolean> {
  // Check if WebSockets are disabled via environment variable FIRST
  if (process.env.NEXT_PUBLIC_DISABLE_WEBSOCKET === 'true') {
    backendAvailable = false;
    return false;
  }

  const now = Date.now();
  
  // Return cached result if recent
  if (backendAvailable !== null && now - lastCheck < CACHE_DURATION) {
    return backendAvailable;
  }
  
  // Don't check too frequently if backend is down
  if (now - lastCheck < CHECK_INTERVAL && backendAvailable === false) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      backendAvailable = response.ok || response.status === 404;
      lastCheck = now;
      return backendAvailable;
    } catch {
      clearTimeout(timeoutId);
      // Try alternative check
      try {
        await fetch(`${baseUrl}/`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(1000),
        });
        backendAvailable = true;
        lastCheck = now;
        return true;
      } catch {
        backendAvailable = false;
        lastCheck = now;
        return false;
      }
    }
  } catch {
    backendAvailable = false;
    lastCheck = now;
    return false;
  }
}

export function resetBackendCheck() {
  backendAvailable = null;
  lastCheck = 0;
}

