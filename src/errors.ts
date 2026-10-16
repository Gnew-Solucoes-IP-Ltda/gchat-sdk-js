export class NativeChannelError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, body: Record<string, unknown> = {}) {
    super(`${status} ${code}`);
    this.name = 'NativeChannelError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
