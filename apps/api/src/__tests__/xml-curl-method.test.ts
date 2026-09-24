import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * mod_xml_curl sends its `method` param verbatim as the HTTP method. Node's
 * parser rejects a lowercase `post` with a 400 "Client Error" before the API
 * sees the request, so the directory lookup fails, FreeSWITCH falls back to the
 * static XML's old shared password, and every softphone gets 403 Forbidden.
 */
describe('the FreeSWITCH directory binding', () => {
  const config = readFileSync(
    join(__dirname, '..', '..', '..', 'freeswitch', 'conf', 'autoload_configs', 'xml_curl.conf.xml'),
    'utf8'
  );

  it('uses an uppercase HTTP method', () => {
    const method = /<param name="method" value="([^"]+)"\s*\/>/.exec(config)?.[1];
    expect(method).toBe('POST');
  });
});
