// Minimal ambient declarations for the tiny slice of Node's built-in API
// this project's CLI touches (src/cli.ts's --json/--from file I/O). No
// devDependency on @types/node — the runtime surface is small enough to
// hand-declare, matching scripts/demo.ts's precedent for `process`/`console`.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
}
