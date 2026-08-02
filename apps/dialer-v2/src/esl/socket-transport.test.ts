import { EventEmitter } from 'node:events';
import type net from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import type { RawEslEvent } from '../events/types.js';

import {
  ForbiddenEslCommandError,
  SocketEslTransport,
  assertCommandIsReadOnly,
  parseEventBody,
} from './socket-transport.js';

/** A fake socket that records every byte written. */
class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  setEncoding(): this {
    return this;
  }
  connect(): this {
    // The banner FreeSWITCH sends first.
    queueMicrotask(() => this.emit('data', 'Content-Type: auth/request\n\n'));
    return this;
  }
  write(data: string): boolean {
    this.written.push(data);
    // Accept the auth immediately.
    if (data.startsWith('auth ')) {
      queueMicrotask(() =>
        this.emit('data', 'Content-Type: command/reply\nReply-Text: +OK accepted\n\n')
      );
    }
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function build(onCommand?: (c: string) => void) {
  const socket = new FakeSocket();
  const transport = new SocketEslTransport({
    host: 'freeswitch',
    port: 8021,
    password: 'super-secret-esl-password',
    createSocket: () => socket as unknown as net.Socket,
    onCommand,
  });
  return { socket, transport };
}

describe('the read-only guarantee', () => {
  it('refuses every call-control command', () => {
    const forbidden = [
      'originate sofia/gateway/fractel1/+18005551212 &park()',
      'bgapi originate sofia/gateway/fractel1/+15551234567',
      'api uuid_kill abc',
      'uuid_transfer abc 1000',
      'uuid_bridge a b',
      'sendmsg abc\ncall-command: execute',
      'hangup',
      'bgapi status',
      'event json ALL',
      'filter Unique-ID abc',
      'events plain ALL',
    ];
    for (const command of forbidden) {
      expect(() => assertCommandIsReadOnly(command), command).toThrow(ForbiddenEslCommandError);
    }
  });

  it('permits only auth and event-plain subscription', () => {
    expect(() => assertCommandIsReadOnly('auth secret')).not.toThrow();
    expect(() => assertCommandIsReadOnly('event plain CHANNEL_ANSWER')).not.toThrow();
  });

  it('names the command but never the password when refusing', () => {
    try {
      assertCommandIsReadOnly('originate sofia/gateway/x/+15551234567');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).toContain('originate');
      expect(String(error)).not.toContain('+15551234567');
    }
  });

  it('writes exactly two commands across a full connect and subscribe', async () => {
    const { socket, transport } = build();
    await transport.connect();
    await transport.subscribe(['CHANNEL_ANSWER', 'CHANNEL_HANGUP']);

    expect(socket.written).toHaveLength(2);
    expect(socket.written[0]).toMatch(/^auth /);
    expect(socket.written[1]).toBe('event plain CHANNEL_ANSWER CHANNEL_HANGUP\n\n');

    const all = socket.written.join(' ');
    for (const banned of ['originate', 'bgapi', 'uuid_', 'sendmsg', 'bridge', 'hangup']) {
      expect(all).not.toContain(banned);
    }
  });
});

describe('the password never leaks', () => {
  it('is redacted in the command recorder', async () => {
    const commands: string[] = [];
    const { transport } = build(c => commands.push(c));
    await transport.connect();
    await transport.subscribe(['CHANNEL_ANSWER']);

    expect(commands[0]).toBe('auth <redacted>');
    expect(commands.join(' ')).not.toContain('super-secret-esl-password');
  });

  it('is absent from an authentication failure message', async () => {
    const socket = new FakeSocket();
    socket.write = function (data: string): boolean {
      this.written.push(data);
      if (data.startsWith('auth ')) {
        queueMicrotask(() =>
          this.emit(
            'data',
            'Content-Type: command/reply\nReply-Text: -ERR invalid password super-secret-esl-password\n\n'
          )
        );
      }
      return true;
    };
    const transport = new SocketEslTransport({
      host: 'freeswitch',
      port: 8021,
      password: 'super-secret-esl-password',
      createSocket: () => socket as unknown as net.Socket,
    });

    await expect(transport.connect()).rejects.toThrow(/authentication rejected/);
    await transport.connect().catch((error: Error) => {
      expect(error.message).not.toContain('super-secret-esl-password');
    });
  });
});

describe('protocol handling', () => {
  it('authenticates in response to the banner', async () => {
    const { socket, transport } = build();
    await transport.connect();
    expect(socket.written[0]).toBe('auth super-secret-esl-password\n\n');
  });

  it('parses a content-length framed event', async () => {
    const { socket, transport } = build();
    const received: RawEslEvent[] = [];
    transport.onEvent(e => received.push(e));
    await transport.connect();

    const body =
      'Event-Name: CHANNEL_ANSWER\nUnique-ID: chan-1\nCaller-Destination-Number: %2B18005551212\n';
    socket.emit(
      'data',
      `Content-Type: text/event-plain\nContent-Length: ${body.length}\n\n${body}`
    );

    expect(received).toHaveLength(1);
    expect(received[0]['Event-Name']).toBe('CHANNEL_ANSWER');
    // Header values are URL-encoded on the wire.
    expect(received[0]['Caller-Destination-Number']).toBe('+18005551212');
  });

  it('waits for a partial frame rather than parsing garbage', async () => {
    const { socket, transport } = build();
    const received: RawEslEvent[] = [];
    transport.onEvent(e => received.push(e));
    await transport.connect();

    const body = 'Event-Name: CHANNEL_ANSWER\nUnique-ID: chan-1\n';
    socket.emit('data', `Content-Type: text/event-plain\nContent-Length: ${body.length}\n\n`);
    socket.emit('data', body.slice(0, 10));
    expect(received).toHaveLength(0);

    socket.emit('data', body.slice(10));
    expect(received).toHaveLength(1);
  });

  it('handles two events arriving in one chunk', async () => {
    const { socket, transport } = build();
    const received: RawEslEvent[] = [];
    transport.onEvent(e => received.push(e));
    await transport.connect();

    const one = 'Event-Name: CHANNEL_CREATE\nUnique-ID: a\n';
    const two = 'Event-Name: CHANNEL_ANSWER\nUnique-ID: b\n';
    socket.emit(
      'data',
      `Content-Type: text/event-plain\nContent-Length: ${one.length}\n\n${one}` +
        `Content-Type: text/event-plain\nContent-Length: ${two.length}\n\n${two}`
    );

    expect(received.map(e => e['Event-Name'])).toEqual(['CHANNEL_CREATE', 'CHANNEL_ANSWER']);
  });

  it('decodes plus signs and percent escapes', () => {
    const parsed = parseEventBody('A: hello+world\nB: %2B1555\nC: bad%ZZescape\n');
    expect(parsed.A).toBe('hello world');
    expect(parsed.B).toBe('+1555');
    // A malformed escape is passed through rather than throwing.
    expect(parsed.C).toBe('bad%ZZescape');
  });
});

describe('lifecycle', () => {
  it('rejects a subscribe before connect', async () => {
    const { transport } = build();
    await expect(transport.subscribe(['CHANNEL_ANSWER'])).rejects.toThrow(/not connected/);
  });

  it('destroys the socket and clears listeners on disconnect', async () => {
    const { socket, transport } = build();
    await transport.connect();
    transport.disconnect();
    expect(socket.destroyed).toBe(true);
    expect(socket.listenerCount('data')).toBe(0);
  });

  it('surfaces a close after authentication as a close, not an auth failure', async () => {
    const { socket, transport } = build();
    const onClose = vi.fn();
    transport.onClose(onClose);
    await transport.connect();
    socket.emit('close');
    expect(onClose).toHaveBeenCalled();
  });
});
