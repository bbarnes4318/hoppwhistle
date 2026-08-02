/**
 * Dialer V2 — minimal read-only ESL transport.
 *
 * Implements just enough of the FreeSWITCH inbound ESL protocol to authenticate
 * and subscribe to events. Written directly against a TCP socket rather than
 * using a general-purpose ESL library, because the central security claim of
 * this service is *exactly which bytes are written to FreeSWITCH*, and a library
 * that exposes `api`/`bgapi`/`sendmsg` makes that claim unverifiable.
 *
 * ── What this class can write ────────────────────────────────────────────────
 *
 *   auth <password>\n\n
 *   event plain <EVENT NAMES>\n\n
 *
 * That is the complete set. `write()` is private, every call site is in this
 * file, and `assertCommandIsReadOnly` rejects anything else before it reaches
 * the socket — so even a future edit cannot introduce an `originate` without
 * removing an explicit guard.
 */

import net from 'node:net';

import type { RawEslEvent } from '../events/types.js';

import type { EslTransport } from './client.js';

/**
 * Commands this transport is permitted to send. Anything else throws.
 * `originate`, `bgapi`, `api`, `sendmsg`, `uuid_*`, `bridge`, and `hangup` are
 * all outside this set by construction.
 */
const ALLOWED_COMMAND_PREFIXES = ['auth ', 'event plain '] as const;

export class ForbiddenEslCommandError extends Error {
  constructor(command: string) {
    // The password is never included — `auth ` commands are reported by prefix.
    super(`Dialer V2 refused to send a non-read-only ESL command: ${command.split(' ')[0]}`);
    this.name = 'ForbiddenEslCommandError';
  }
}

export function assertCommandIsReadOnly(command: string): void {
  if (!ALLOWED_COMMAND_PREFIXES.some(prefix => command.startsWith(prefix))) {
    throw new ForbiddenEslCommandError(command);
  }
}

export interface SocketTransportOptions {
  host: string;
  port: number;
  password: string;
  connectTimeoutMs?: number;
  /** Injected in tests. */
  createSocket?: () => net.Socket;
  /** Records every command sent, minus secrets. For tests and audit. */
  onCommand?: (redacted: string) => void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/** ESL event-plain header values are URL-encoded. */
function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Parse `Key: Value` lines into a map.
 *
 * `decode` matters. Values in an event-plain BODY are URL-encoded; the protocol
 * HEADER block is not. Decoding the header block turns a `+OK accepted` reply
 * into ` OK accepted`, so authentication never matches — this distinction exists
 * because that bug was real and the tests caught it.
 */
function parseLines(text: string, decode: boolean): RawEslEvent {
  const event: RawEslEvent = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.length > 0) event[key] = decode ? decodeValue(value) : value;
  }
  return event;
}

/** Parse an event-plain body. Values are URL-encoded on the wire. */
export function parseEventBody(body: string): RawEslEvent {
  return parseLines(body, true);
}

/** Parse a protocol header block. Values are NOT URL-encoded. */
export function parseProtocolHeaders(text: string): RawEslEvent {
  return parseLines(text, false);
}

export class SocketEslTransport implements EslTransport {
  private socket: net.Socket | null = null;
  private buffer = '';
  private eventHandler: ((raw: RawEslEvent) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private authResolve: (() => void) | null = null;
  private authReject: ((error: Error) => void) | null = null;
  private authenticated = false;
  private clearAuthTimer: (() => void) | null = null;

  constructor(private readonly options: SocketTransportOptions) {}

  onEvent(handler: (raw: RawEslEvent) => void): void {
    this.eventHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.options.createSocket ? this.options.createSocket() : new net.Socket();
      this.socket = socket;
      this.authResolve = resolve;
      this.authReject = reject;

      const timeout = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (!this.authenticated) {
          this.failAuth(new Error('ESL authentication timed out'));
        }
      }, timeout);
      // Do not hold the event loop open on this timer: a pending auth timeout
      // would otherwise keep the process (and the test runner) alive.
      timer.unref?.();
      this.clearAuthTimer = () => clearTimeout(timer);

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        this.drain();
      });
      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        if (!this.authenticated) this.failAuth(error);
        else this.errorHandler?.(error);
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!this.authenticated) this.failAuth(new Error('ESL connection closed before auth'));
        else this.closeHandler?.();
      });

      socket.connect(this.options.port, this.options.host);
    });
  }

  private failAuth(error: Error): void {
    this.clearAuthTimer?.();
    const reject = this.authReject;
    this.authResolve = null;
    this.authReject = null;
    reject?.(error);
  }

  /**
   * The ONLY method that writes to the socket. Private, guarded, and every
   * caller is in this file.
   */
  private write(command: string): void {
    assertCommandIsReadOnly(command);
    // Redact the password before it can reach a log, a test recorder, or a
    // stack trace.
    const redacted = command.startsWith('auth ') ? 'auth <redacted>' : command;
    this.options.onCommand?.(redacted);
    this.socket?.write(`${command}\n\n`);
  }

  /** Consume complete `Content-Length`-framed messages from the buffer. */
  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\n\n');
      if (headerEnd === -1) return;

      const rawHeaders = this.buffer.slice(0, headerEnd);
      const headers = parseProtocolHeaders(rawHeaders);
      const contentLength = Number.parseInt(headers['Content-Length'] ?? '0', 10);
      const bodyStart = headerEnd + 2;

      if (Number.isFinite(contentLength) && contentLength > 0) {
        if (this.buffer.length < bodyStart + contentLength) return; // wait for more
        const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
        this.buffer = this.buffer.slice(bodyStart + contentLength);
        this.handleMessage(headers, body);
      } else {
        this.buffer = this.buffer.slice(bodyStart);
        this.handleMessage(headers, '');
      }
    }
  }

  private handleMessage(headers: RawEslEvent, body: string): void {
    const contentType = headers['Content-Type'];

    if (contentType === 'auth/request') {
      this.write(`auth ${this.options.password}`);
      return;
    }

    if (contentType === 'command/reply' || contentType === 'api/response') {
      const replyText = headers['Reply-Text'] ?? body;
      if (!this.authenticated) {
        if (replyText.startsWith('+OK')) {
          this.authenticated = true;
          this.clearAuthTimer?.();
          const resolve = this.authResolve;
          this.authResolve = null;
          this.authReject = null;
          resolve?.();
        } else {
          // Never include the reply text: a failed auth reply can echo detail.
          this.failAuth(new Error('ESL authentication rejected'));
        }
      }
      return;
    }

    if (contentType === 'text/event-plain' && body.length > 0) {
      this.eventHandler?.(parseEventBody(body));
    }
  }

  subscribe(eventNames: readonly string[]): Promise<void> {
    if (!this.socket) return Promise.reject(new Error('ESL socket is not connected'));
    // `event plain` is a subscription. It cannot execute anything.
    this.write(`event plain ${eventNames.join(' ')}`);
    return Promise.resolve();
  }

  disconnect(): void {
    this.clearAuthTimer?.();
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.buffer = '';
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }
}
