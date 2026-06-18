/** Minimal fetch-like interfaces that work in both web and React Native. */

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

/** Typed API error thrown by the API client. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
