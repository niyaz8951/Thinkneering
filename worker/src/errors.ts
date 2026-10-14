/* One error type for everything a route refuses. The message is shown to the user as it is
   (plain wording, no stack), so write it for a person. 'SESSION_EXPIRED' is the one code the
   pages react to (hub.js signs the user out). */
export class HubError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HubError";
    this.status = status;
  }
}

export function fail(message: string, status = 400): never {
  throw new HubError(message, status);
}

export const SESSION_EXPIRED = "SESSION_EXPIRED";
