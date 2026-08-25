import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { delayForAttempt, isRetryableStatus, parseRetryAfter, sleep } from "./backoff";
import type { HttpResponse, LogEvent } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(setCookie: string | string[] | undefined) {
    const list = !setCookie ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const pair = raw.split(";")[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name.toLowerCase() === "expires" || name.toLowerCase() === "path") continue;
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export type HttpClientOptions = {
  delayMs?: number;
  timeoutMs?: number;
  logger?: (event: LogEvent) => void;
};

function headerMap(headers: AxiosResponse["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data);
  return null;
}

export class HttpClient {
  readonly jar = new CookieJar();
  private readonly axios: AxiosInstance;
  private lastRequestAt = 0;
  readonly delayMs: number;
  private retries429 = 0;
  private log: (event: LogEvent) => void;

  constructor(opts: HttpClientOptions = {}) {
    this.delayMs = opts.delayMs ?? 800;
    this.log = opts.logger ?? (() => undefined);
    this.axios = axios.create({
      timeout: opts.timeoutMs ?? 45_000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      responseType: "arraybuffer",
      decompress: true,
    });
  }

  getRetries429() {
    return this.retries429;
  }

  private async throttle() {
    const wait = this.delayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private absorbCookies(res: AxiosResponse) {
    const setCookie = res.headers["set-cookie"];
    this.jar.absorb(setCookie);
  }

  private async follow(
    method: "get" | "post",
    url: string,
    data?: URLSearchParams,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse> {
    let current = url;
    let currentMethod = method;
    let currentData = data;
    for (let hop = 0; hop < 8; hop++) {
      await this.throttle();
      const cookie = this.jar.header();
      const res = await this.axios.request({
        method: currentMethod,
        url: current,
        data: currentData ? currentData.toString() : undefined,
        headers: {
          Cookie: cookie || undefined,
          Referer: current,
          ...(currentMethod === "post"
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
          ...extraHeaders,
        },
      });
      this.absorbCookies(res);
      const headers = headerMap(res.headers);
      if (res.status >= 300 && res.status < 400 && headers.location) {
        let next = headers.location;
        if (next.startsWith("http://")) next = next.replace(/^http:\/\//, "https://");
        if (next.startsWith("/")) {
          const base = new URL(current);
          next = `${base.origin}${next}`;
        }
        current = next;
        currentMethod = "get";
        currentData = undefined;
        continue;
      }
      const buf = toBuffer(res.data) ?? Buffer.alloc(0);
      const contentType = headers["content-type"] ?? "";
      const body = contentType.includes("application/pdf") || contentType.includes("octet-stream")
        ? ""
        : buf.toString("utf8");
      return {
        status: res.status,
        url: current,
        headers,
        body,
        buffer: buf,
      };
    }
    throw new Error(`Too many redirects from ${url}`);
  }

  async request(
    method: "get" | "post",
    url: string,
    data?: URLSearchParams,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse> {
    const maxAttempts = 5;
    let last: HttpResponse | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await this.follow(method, url, data, extraHeaders);
      last = res;
      if (!isRetryableStatus(res.status)) return res;
      if (res.status === 429) this.retries429 += 1;
      const retryAfter = parseRetryAfter(res.headers["retry-after"]);
      const wait = delayForAttempt(attempt, {}, retryAfter);
      this.log({
        t: new Date().toISOString(),
        level: "warn",
        message: `HTTP ${res.status} en ${url} — reintento ${attempt + 1}/${maxAttempts} en ${wait}ms`,
      });
      await sleep(wait);
    }
    return last as HttpResponse;
  }

  get(url: string) {
    return this.request("get", url);
  }

  post(url: string, data: URLSearchParams, extraHeaders?: Record<string, string>) {
    return this.request("post", url, data, extraHeaders);
  }
}

export function isGeoBlocked(res: HttpResponse): boolean {
  if (res.status === 403) return true;
  const text = res.body.toLowerCase();
  return text.includes("403 forbidden") || text.includes("access denied");
}
