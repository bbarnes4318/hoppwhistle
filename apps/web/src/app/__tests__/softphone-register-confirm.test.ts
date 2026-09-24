/**
 * The softphone is registered when the registrar says so, not when the
 * REGISTER leaves the browser.
 *
 * `Registerer.register()` resolves on send. The provider used to take that as
 * success, so a REGISTER answered 403 -- or not answered at all -- still showed
 * the agent connected and available while FreeSWITCH had no contact for them.
 */
import type { Registerer } from 'sip.js';
import { describe, expect, it, vi } from 'vitest';

import { registerAndConfirm } from '@/components/phone/phone-provider';

type Delegate = {
  onAccept?: () => void;
  onReject?: (r: { message: { statusCode: number; reasonPhrase: string } }) => void;
};

function fakeRegisterer(answer: (delegate: Delegate) => void): Registerer {
  return {
    register: vi.fn((options?: { requestDelegate?: Delegate }) => {
      // Sent: the promise SIP.js returns resolves before any answer arrives.
      setTimeout(() => answer(options?.requestDelegate ?? {}), 0);
      return Promise.resolve();
    }),
  } as unknown as Registerer;
}

describe('registerAndConfirm', () => {
  it('resolves when the registrar accepts', async () => {
    await expect(registerAndConfirm(fakeRegisterer(d => d.onAccept?.()))).resolves.toBeUndefined();
  });

  it('rejects when the registrar refuses, naming the answer', async () => {
    const registerer = fakeRegisterer(d =>
      d.onReject?.({ message: { statusCode: 403, reasonPhrase: 'Forbidden' } })
    );
    await expect(registerAndConfirm(registerer)).rejects.toThrow('403 Forbidden');
  });

  it('rejects when the registrar never answers', async () => {
    await expect(registerAndConfirm(fakeRegisterer(() => {}), 20)).rejects.toThrow('no answer');
  });
});
