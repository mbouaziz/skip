import type { float, int, Environment, Wrk, Shared } from "./sk_types.js";
import { MemFS, MemSys } from "./sk_mem_utils.js";

class WrkImpl implements Wrk {
  constructor(private readonly worker: Worker) {}

  static fromPath(url: URL, options?: WorkerOptions) {
    return new this(new Worker(url, options));
  }

  postMessage = (message: any) => {
    this.worker.postMessage(message);
  };

  onMessage = (listener: (value: any) => void) => {
    this.worker.onmessage = listener;
  };
}

class Env implements Environment {
  readonly shared: Map<string, Shared>;
  disableWarnings: boolean = false;
  readonly fileSystem: MemFS;
  readonly system: MemSys;
  readonly timestamp: () => float;
  readonly decodeUTF8: (utf8: ArrayBuffer) => string;
  readonly encodeUTF8: (str: string) => Uint8Array;
  readonly storage: () => Storage;
  readonly onException: () => void;
  readonly base64Decode: (base64: string) => Uint8Array;
  readonly base64Encode: (toEncode: string, url?: boolean) => string;
  readonly createSocket: (url: string) => WebSocket;
  readonly createWorker: (url: URL, options?: WorkerOptions) => Wrk;
  readonly createWorkerWrapper: (worker: Worker) => Wrk;
  readonly crypto: () => Crypto;
  readonly environment: string[];

  throwRuntime = (code: int) => {
    this.onException();
    if (code != 0) {
      throw new Error(`Error with code: ${code}`);
    }
  };

  fs() {
    return this.fileSystem;
  }

  sys() {
    return this.system;
  }

  name() {
    return "browser";
  }

  async fetch(url: URL | string) {
    let fUrl;
    if (url instanceof URL) {
      fUrl = url;
    } else {
      fUrl = new URL(url, import.meta.url);
    }
    return fetch(fUrl)
      .then((res) => res.arrayBuffer())
      .then((ab) => new Uint8Array(ab));
  }

  constructor(environment?: string[]) {
    this.shared = new Map<string, Shared>();
    this.fileSystem = new MemFS();
    this.system = new MemSys();
    this.environment = environment ?? [];
    const global = typeof window == "undefined" ? self : window;
    this.timestamp = () => global.performance.now();
    const decoder = new TextDecoder("utf8");
    this.decodeUTF8 = (utf8: ArrayBuffer) => decoder.decode(utf8);
    const encoder = new TextEncoder(); // always utf-8
    this.encodeUTF8 = (str: string) => encoder.encode(str);
    this.base64Decode = (base64: string) =>
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.base64Encode = (toEncode: string, url: boolean = false) => {
      const base64 = btoa(toEncode);
      return url ? base64.replaceAll("+", "-").replaceAll("/", "_") : base64;
    };
    this.storage = () => localStorage;
    this.onException = () => {
      /* default nop hook */
    };
    this.createSocket = (url: string) => new WebSocket(url);
    this.createWorker = (url: URL, options?: WorkerOptions) =>
      WrkImpl.fromPath(url, options);
    this.createWorkerWrapper = (worker: Worker) => new WrkImpl(worker);
    this.crypto = () => crypto;
  }
}

export function environment(environment?: string[]) {
  return new Env(environment);
}
