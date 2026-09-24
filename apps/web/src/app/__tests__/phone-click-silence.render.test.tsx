/**
 * Clicking around the app must not make the softphone ring.
 *
 * PhoneProvider used to "unlock" browser audio by playing the ringtone mp3 and
 * pausing it when play() resolved -- on every click, key and pointer press, for
 * as long as the page was open. play() is audible before its promise settles,
 * so every click was a burst of ringing. The unlock now only resumes the
 * AudioContext the ring is synthesised on, and stops listening once it runs.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhoneProvider } from '@/components/phone';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

describe('the softphone and ordinary clicks', () => {
  let play: { mock: { calls: unknown[] } };

  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    );
    play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('plays no audio when the user clicks and types', async () => {
    render(
      <PhoneProvider enabled={false}>
        <button>somewhere in the app</button>
      </PhoneProvider>
    );

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
      fireEvent.keyDown(document.body, { key: 'a' });
      await Promise.resolve();
    }

    expect(play).not.toHaveBeenCalled();
  });

  it('wakes the ring AudioContext once and then stops listening', async () => {
    render(
      <PhoneProvider enabled={false}>
        <div />
      </PhoneProvider>
    );

    fireEvent.click(document.body);
    await Promise.resolve();
    fireEvent.click(document.body);
    fireEvent.pointerDown(document.body);
    await Promise.resolve();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances[0].state).toBe('running');
  });
});
