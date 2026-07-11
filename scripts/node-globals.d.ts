// Minimal ambient declarations for the couple of Node globals the demo
// script touches. We intentionally avoid a devDependency on @types/node
// (specs/M1.md: "Dev deps: typescript, vitest only.") — this project's
// runtime surface is tiny enough that hand-declaring it is simpler than
// pulling in the full Node type-definition package.

declare const process: {
  argv: string[];
};

declare const console: {
  log(...args: unknown[]): void;
};
