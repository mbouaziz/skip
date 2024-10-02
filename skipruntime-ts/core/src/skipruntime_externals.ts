import type { AValue, ExternalCall, TJSON } from "./skipruntime_api.js";

type RefreshTokenId = string;

type RefreshPolicy = RefreshTokenId | ["headers", RefreshTokenId];

export abstract class GenericFetch<
  V extends TJSON,
  Metadata extends TJSON = never,
> implements ExternalCall<string, V, Metadata>
{
  async call(url: string, timestamp: number): Promise<AValue<V, Metadata>> {
    const response = await fetch(url);
    return await this.processResponse(response, timestamp);
  }

  abstract processResponse(
    response: Response,
    timestamp: number,
  ): AValue<V, Metadata> | Promise<AValue<V, Metadata>>;
}

export type FetchMetadata = { timestamp: number; expires?: number };

function expiresFromHeaders(headers: Headers): number | undefined {
  // This assumes HTTP headers, which may not be the case, but that can't be harmful in most cases
  const expires = headers.get("expires");
  if (expires) {
    const expiresMS = new Date(expires).getTime();
    if (!isNaN(expiresMS)) {
      const now = Date.now();
      if (expiresMS > now) {
        return expiresMS;
      }
    }
  }
  const cacheControl = headers.get("cache-control");
  if (cacheControl) {
    const parts = cacheControl.split(",");
    for (let part of parts) {
      part = part.trim();
      if (part.startsWith("max-age=")) {
        const maxAge = Number(part.substring(8));
        if (!isNaN(maxAge) && maxAge > 0) {
          return Date.now() + maxAge * 1000;
        }
      }
    }
  }
  return undefined;
}

export abstract class Fetch<V extends TJSON> extends GenericFetch<
  V,
  FetchMetadata
> {
  override async processResponse(
    response: Response,
    timestamp: number,
  ): Promise<AValue<V, FetchMetadata>> {
    if (!response.ok) {
      throw new Error(
        `Fetch failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    if (response.body === null) {
      throw new Error(`Empty body`);
    }
    const payload = await this.processOkResponse(response);

    const metadata: FetchMetadata = { timestamp };
    const expires = expiresFromHeaders(response.headers);
    if (expires !== undefined) {
      metadata.expires = expires;
    }

    return { payload, metadata };
  }

  abstract processOkResponse(response: Response): V | Promise<V>;
}

export class FetchText extends Fetch<string> {
  override processOkResponse(response: Response): Promise<string> {
    return response.text();
  }
}

export class FetchJSON extends Fetch<TJSON> {
  override processOkResponse(response: Response): Promise<TJSON> {
    return response.json();
  }
}
