/**
 * Proves the carrier RPA feature is fully isolated from the phone/dialer
 * system, and that the test environment never launches a real browser or
 * contacts American Amicable.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect } from 'vitest';

import { runAmericanAmicableAutomation } from '../services/carrier-rpa/american-amicable.js';
import type { NormalizedCarrierPayload } from '../services/carrier-rpa/normalization.js';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

// Modules that belong to the phone/dialer/SIP/FreeSWITCH system. The carrier
// RPA feature must never import any of them.
const FORBIDDEN_IMPORTS = [
  'freeswitch-service',
  'call-state',
  'event-bus',
  'lead-service',
  'agent-phone',
  'signalwire',
  'ai-campaign',
  'fronter-bot',
  'did-route',
  'routes/bot',
  'modesl',
  'verto',
  'sip.js',
];

describe('Carrier RPA isolation from the phone system', () => {
  it('carrier-rpa modules and automation routes import no phone/dialer code', () => {
    const filesToCheck = [
      join(SRC_DIR, 'routes', 'automation.ts'),
      ...readdirSync(join(SRC_DIR, 'services', 'carrier-rpa')).map(f =>
        join(SRC_DIR, 'services', 'carrier-rpa', f)
      ),
    ];

    expect(filesToCheck.length).toBeGreaterThan(5);

    for (const file of filesToCheck) {
      const source = readFileSync(file, 'utf8');
      const importLines = source
        .split('\n')
        .filter(line => /^\s*(import|export).*from\s+['"]/.test(line) || /require\(/.test(line));

      for (const forbidden of FORBIDDEN_IMPORTS) {
        for (const line of importLines) {
          expect(
            line.includes(forbidden),
            `${file} imports forbidden phone/dialer module "${forbidden}": ${line.trim()}`
          ).toBe(false);
        }
      }
    }
  });

  it('NODE_ENV=test returns a mocked result without launching a browser', async () => {
    expect(process.env.NODE_ENV).toBe('test');

    const start = Date.now();
    const result = await runAmericanAmicableAutomation(
      {
        firstName: 'Unit',
        lastName: 'Test',
        state: 'Illinois',
        selectedCoverage: 10000,
      } as NormalizedCarrierPayload,
      null
    );
    const elapsed = Date.now() - start;

    // A real Puppeteer launch + carrier login would take many seconds;
    // the test-mode path must return effectively instantly.
    expect(elapsed).toBeLessThan(1000);
    expect(result.success).toBe(true);
    expect(result.applicationNumber).toBe('M001234567');
    expect(result.customer).toBe('Unit Test');
  });
});
