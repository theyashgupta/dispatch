/** Thrown by startup preflight steps (config load) to fail fast with a clear message. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}
