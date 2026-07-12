// Minimal ambient declaration for the slice of 'node:http' that
// scripts/serve.ts touches. Same rationale as src/node-shims.d.ts: no
// devDependency on @types/node — the runtime surface is small enough to
// hand-declare.

declare module 'node:http' {
  export type IncomingMessage = { url?: string };
  export type ServerResponse = {
    writeHead(status: number, headers: Record<string, string>): void;
    end(body?: string): void;
  };
  export type Server = {
    listen(port: number, host: string, onListening: () => void): void;
  };
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
