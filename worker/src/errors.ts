/* One error type for everything a route refuses. The message is shown to the user as it is
   (plain wording, no stack), so write it for a person. 'SESSION_EXPIRED' is the one code the
   pages react to (hub.js signs the user out). */
export class HubError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  constructor(message: string, status = 400, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "HubError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function fail(message: string, status = 400): never {
  throw new HubError(message, status);
}

/* A refusal a page can act on: a code and the data it needs (e.g. PRODUCT_MISMATCH with the product it looks like). */
export function failWith(code: string, message: string, data: Record<string, unknown>, status = 409): never {
  throw new HubError(message, status, code, data);
}

export const SESSION_EXPIRED = "SESSION_EXPIRED";
