/**
 * Vapi Carrier Service
 *
 * Manages Vapi SIP trunk credentials and phone number provisioning
 * for multiple carriers (FreeSWITCH/BulkVS and SignalWire).
 *
 * Each carrier has its own Vapi credential (BYO SIP trunk) and its own
 * pool of DIDs registered as BYO phone numbers.
 */

// ============================================================================
// Types
// ============================================================================

export type VoipCarrier = 'bulkvs' | 'signalwire';

interface VapiCredential {
  id: string;
  provider: string;
  name?: string;
  gateways?: Array<{
    ip: string;
    port?: number;
    netmask?: number;
    inboundEnabled?: boolean;
    outboundEnabled?: boolean;
    outboundProtocol?: string;
  }>;
  sipUri?: string;
  outboundAuthenticationPlan?: {
    authUsername?: string;
    authPassword?: string;
  };
}

interface VapiPhoneNumber {
  id: string;
  number: string;
  provider: string;
  credentialId?: string;
  name?: string;
}

interface CarrierConfig {
  carrier: VoipCarrier;
  credentialId: string;
  dids: Array<{ did: string; vapiPhoneId: string }>;
}

// ============================================================================
// Configuration
// ============================================================================

const VAPI_API_TOKEN = process.env.VAPI_API_TOKEN || process.env.VAPI_API_KEY || '';

/**
 * FreeSWITCH / BulkVS carrier config (existing setup)
 */
const FREESWITCH_CONFIG = {
  host: process.env.PUBLIC_IP || '3.214.60.13',
  port: 5070,
  username: 'vapi',
  password: 'VapiFS_5070_StrongPass!9xQ2',
};

/**
 * SignalWire carrier config
 */
const SIGNALWIRE_CONFIG = {
  sipUri: process.env.SIGNALWIRE_SIP_URI || 'sip:fe@pvn-shanevici.sip.signalwire.com',
  // Merged DID pool — SignalWire DIDs first, then BulkVS DIDs for unified rotation
  dids: [
    // SignalWire DIDs
    '+18652679650',
    '+17253022220',
    // BulkVS DIDs
    '+12816989460',
    '+12816989461',
    '+14063165877',
    '+14402992856',
    '+14402992860',
    '+16102819660',
    '+16102819662',
    '+17038313168',
    '+17042283589',
    '+17042286088',
    '+18036135410',
    '+18036135412',
    '+19124185540',
    '+19124185542',
    '+19542083921',
    '+19542083922',
  ],
};

// ============================================================================
// Vapi API Helper
// ============================================================================

async function vapiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Vapi API ${response.status}: ${JSON.stringify(data).substring(0, 300)}`
    );
  }

  return data as T;
}

// ============================================================================
// Credential Management
// ============================================================================

/**
 * Get or create the BYO SIP trunk credential for FreeSWITCH (BulkVS carrier).
 * This is the existing setup — calls go Vapi → FreeSWITCH → BulkVS signing → DIDCentral/FracTEL.
 */
async function getOrCreateFreeSwitchCredential(): Promise<string> {
  const credentials = await vapiRequest<VapiCredential[]>('GET', '/credential');
  const existing = Array.isArray(credentials)
    ? credentials.find(c => {
        if (c.provider !== 'byo-sip-trunk') return false;
        return c.gateways?.some(g => g.ip === FREESWITCH_CONFIG.host);
      })
    : null;

  if (existing) {
    // Ensure inbound is enabled
    const gw = existing.gateways?.find(g => g.ip === FREESWITCH_CONFIG.host);
    if (gw && gw.inboundEnabled === false) {
      await vapiRequest('PATCH', `/credential/${existing.id}`, {
        gateways: [
          {
            ip: FREESWITCH_CONFIG.host,
            port: FREESWITCH_CONFIG.port,
            netmask: 32,
            inboundEnabled: true,
            outboundEnabled: true,
            outboundProtocol: 'udp',
          },
        ],
      });
    }
    return existing.id;
  }

  // Create new
  const result = await vapiRequest<VapiCredential>('POST', '/credential', {
    provider: 'byo-sip-trunk',
    name: 'FreeSWITCH Vapi Trunk',
    gateways: [
      {
        ip: FREESWITCH_CONFIG.host,
        port: FREESWITCH_CONFIG.port,
        netmask: 32,
        inboundEnabled: true,
        outboundEnabled: true,
        outboundProtocol: 'udp',
      },
    ],
    outboundAuthenticationPlan: {
      authUsername: FREESWITCH_CONFIG.username,
      authPassword: FREESWITCH_CONFIG.password,
    },
  });

  return result.id;
}

/**
 * Get or create the BYO SIP trunk credential for SignalWire.
 * Calls go Vapi → SignalWire SIP domain → PSTN.
 * No STIR/SHAKEN signing needed — SignalWire handles it internally.
 */
async function getOrCreateSignalWireCredential(): Promise<string> {
  const credentials = await vapiRequest<VapiCredential[]>('GET', '/credential');
  const existing = Array.isArray(credentials)
    ? credentials.find(c => {
        if (c.provider !== 'byo-sip-trunk') return false;
        // Match by name or SIP URI
        if (c.name === 'SignalWire Outbound Trunk') return true;
        if (c.sipUri && c.sipUri.includes('signalwire.com')) return true;
        // Also check gateways matching the SignalWire outbound proxy
        return c.gateways?.some(g => g.ip.includes('signalwire'));
      })
    : null;

  if (existing) {
    return existing.id;
  }

  // Create new — SignalWire uses a SIP URI, not IP-based gateways.
  // The SIP URI points to the SignalWire SIP domain app.
  const result = await vapiRequest<VapiCredential>('POST', '/credential', {
    provider: 'byo-sip-trunk',
    name: 'SignalWire Outbound Trunk',
    gateways: [
      {
        ip: SIGNALWIRE_CONFIG.sipUri.replace('sip:', '').split('@')[1],
        port: 5060,
        netmask: 32,
        inboundEnabled: false,
        outboundEnabled: true,
        outboundProtocol: 'udp',
      },
    ],
  });

  return result.id;
}

// ============================================================================
// DID Provisioning
// ============================================================================

/**
 * Provision a set of DIDs in Vapi, binding them to the given credential.
 * Returns the pool of { did, vapiPhoneId } entries.
 */
async function provisionDIDs(
  credentialId: string,
  dids: string[],
  namePrefix: string
): Promise<Array<{ did: string; vapiPhoneId: string }>> {
  let existingNumbers: VapiPhoneNumber[] = [];
  try {
    existingNumbers = await vapiRequest<VapiPhoneNumber[]>('GET', '/phone-number');
    if (!Array.isArray(existingNumbers)) existingNumbers = [];
  } catch {
    existingNumbers = [];
  }

  const pool: Array<{ did: string; vapiPhoneId: string }> = [];

  for (const did of dids) {
    const existing = existingNumbers.find(n => n.number === did);
    if (existing) {
      if (existing.credentialId !== credentialId) {
        await vapiRequest('PATCH', `/phone-number/${existing.id}`, { credentialId });
        console.log(`[VapiCarrier] ${did} rebound to credential ${credentialId}`);
      }
      pool.push({ did, vapiPhoneId: existing.id });
    } else {
      try {
        const result = await vapiRequest<VapiPhoneNumber>('POST', '/phone-number', {
          provider: 'byo-phone-number',
          number: did,
          credentialId,
          name: `${namePrefix} ${did}`,
        });
        pool.push({ did, vapiPhoneId: result.id });
        console.log(`[VapiCarrier] ${did} created → ${result.id}`);
      } catch (err) {
        console.error(`[VapiCarrier] Failed to provision ${did}:`, err);
      }
    }
  }

  return pool;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the carrier and return its credential + DID pool.
 */
export async function initializeCarrier(carrier: VoipCarrier): Promise<CarrierConfig> {
  console.log(`[VapiCarrier] Initializing carrier: ${carrier}`);

  if (carrier === 'signalwire') {
    const credentialId = await getOrCreateSignalWireCredential();
    const dids = await provisionDIDs(credentialId, SIGNALWIRE_CONFIG.dids, 'SW DID');
    return { carrier, credentialId, dids };
  }

  // Default: bulkvs (FreeSWITCH)
  const credentialId = await getOrCreateFreeSwitchCredential();
  // Note: BulkVS DIDs are managed by the owner-dialer CONFIG.DIDS array.
  // We don't auto-provision them here — the owner-dialer handles that.
  return { carrier, credentialId, dids: [] };
}

/**
 * Get the credential ID for a carrier without provisioning DIDs.
 */
export async function getCredentialForCarrier(carrier: VoipCarrier): Promise<string> {
  if (carrier === 'signalwire') {
    return getOrCreateSignalWireCredential();
  }
  return getOrCreateFreeSwitchCredential();
}

/**
 * Get the DID pool for a carrier.
 */
export function getCarrierDIDs(carrier: VoipCarrier): string[] {
  if (carrier === 'signalwire') {
    return SIGNALWIRE_CONFIG.dids;
  }
  // BulkVS DIDs — defined in the owner-dialer, not here
  return [];
}

/**
 * Validate that a carrier value is valid.
 */
export function isValidCarrier(value: string): value is VoipCarrier {
  return value === 'bulkvs' || value === 'signalwire';
}
