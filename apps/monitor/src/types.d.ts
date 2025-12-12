declare module 'modesl' {
  export class Event {
    getBody(): string;
    getHeader(name: string): string;
  }

  export class Connection {
    constructor(host: string, port: number, password: string, callback: () => void);
    api(command: string, callback: (res: Event) => void): void;
    disconnect(): void;
    on(event: 'error', callback: (err: Error) => void): void;
    on(event: string, callback: (data: unknown) => void): void;
  }
}
