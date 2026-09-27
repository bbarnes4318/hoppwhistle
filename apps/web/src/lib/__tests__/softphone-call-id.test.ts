import { describe, expect, it } from 'vitest';

import { inboundCallSid, isSoftphoneCallSid } from '../softphone-call-id';

const SID = 'fs-6f1c2d3e-aaaa-4bbb-8ccc-123456789abc';

describe('inboundCallSid', () => {
  it('reads X-Call-Id through getHeader', () => {
    expect(inboundCallSid({ getHeader: name => (name === 'X-Call-Id' ? SID : undefined) })).toBe(
      SID
    );
  });

  it('reads it from the parsed headers, whatever their case', () => {
    expect(inboundCallSid({ headers: { 'X-Call-ID': [{ raw: ` ${SID} ` }] } })).toBe(SID);
  });

  it('is null when the INVITE carries none, or carries something that is not ours', () => {
    expect(inboundCallSid({ getHeader: () => undefined, headers: {} })).toBeNull();
    expect(inboundCallSid({ getHeader: () => 'abc123@10.0.0.5' })).toBeNull();
    expect(inboundCallSid(null)).toBeNull();
  });
});

describe('isSoftphoneCallSid', () => {
  it('accepts only the fs-<uuid> form', () => {
    expect(isSoftphoneCallSid(SID)).toBe(true);
    expect(isSoftphoneCallSid('call_1712345678')).toBe(false);
    expect(isSoftphoneCallSid(undefined)).toBe(false);
  });
});
