declare module 'modesl' {
  import { EventEmitter } from 'events';
  import { Socket } from 'net';

  export class Connection extends EventEmitter {
    constructor(host: string, port: number, password: string);
    constructor(socket: Socket);

    connect(): void;
    disconnect(): void;
    subscribe(events: string | string[]): void;
    filter(header: string, value: string): void;
    filterDelete(header: string, value: string): void;

    api(command: string, callback?: (res: ApiResponse) => void): void;
    api(command: string, args: string, callback?: (res: ApiResponse) => void): void;
    bgapi(command: string, callback?: (res: ApiResponse) => void): void;
    execute(app: string, arg?: string, uuid?: string): void;
    execute(app: string, arg: string, callback: (res: ApiResponse) => void): void;
    executeAsync(app: string, arg?: string, uuid?: string): void;
    sendEvent(event: Event, callback?: (res: ApiResponse) => void): void;
    sendMessage(headers: Record<string, string>, callback?: (res: ApiResponse) => void): void;
    getInfo(): Info | null;

    on(event: 'esl::ready', listener: () => void): this;
    on(event: 'esl::end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface ApiResponse {
    body?: string;
    headers?: Record<string, string>;
  }

  export interface Info {
    getHeader(name: string): string | undefined;
    getBody(): string | undefined;
  }

  export interface Event {
    type: string;
    headers?: Record<string, string>;
    body?: string;
    getHeader(name: string): string | undefined;
    getBody(): string | undefined;
  }
}
