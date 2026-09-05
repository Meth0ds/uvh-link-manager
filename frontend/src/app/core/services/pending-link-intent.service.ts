import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiRequestError, ApiService } from "./api.service";

const STORAGE_KEY = "uvh.pending-link-intent.v1";
const TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface LinkIntentReceipt {
  intent: string;
  expiresAt: string;
}

export interface ClaimedLinkIntent {
  destination: string;
  expiresAt: string;
}

interface StoredLinkIntent extends LinkIntentReceipt {
  storage: "local" | "session" | "memory";
  state: "active" | "completing";
}

/**
 * Carries an opaque pending-link token after the public site hands the user
 * over to app.uvh.es. The raw destination is only retrieved after verified
 * authentication, so it never needs to live in an auth URL or browser history.
 */
@Injectable({ providedIn: "root" })
export class PendingLinkIntentService {
  private readonly api = inject(ApiService);
  private readonly intent = signal<StoredLinkIntent | null>(this.read());

  readonly pending = computed(() => {
    const record = this.intent();
    return record && record.state === "active" && this.validExpiry(record.expiresAt) ? record : null;
  });
  readonly hasPending = computed(() => this.pending() !== null);
  readonly usingSessionFallback = computed(() => this.pending()?.storage !== "local" && this.pending() !== null);

  constructor() {
    const record = this.intent();
    if (record?.state === "completing") void this.finishCompletion(record);
  }

  async create(destination: string): Promise<LinkIntentReceipt> {
    return this.api.post<LinkIntentReceipt>("/api/v1/link-intents", { destination });
  }

  /** Capture a token from the app-host URL and remove it from the route afterwards. */
  capture(intent: string, expiresAt?: string): boolean {
    if (!TOKEN_PATTERN.test(intent)) return false;
    const expires = expiresAt ? this.validExpiry(expiresAt) : new Date(Date.now() + TTL_MS).toISOString();
    if (!expires) return false;
    const record: StoredLinkIntent = { intent, expiresAt: expires, storage: "memory", state: "active" };

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ intent, expiresAt: expires, state: "active" }));
        window.sessionStorage.removeItem(STORAGE_KEY);
        record.storage = "local";
      } catch {
        try {
          window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ intent, expiresAt: expires, state: "active" }));
          record.storage = "session";
        } catch {
          // Keep the current app session useful even under strict privacy modes.
          record.storage = "memory";
        }
      }
    }

    this.intent.set(record);
    return true;
  }

  async claim(): Promise<ClaimedLinkIntent | null> {
    const intent = this.freshIntent();
    if (!intent) return null;
    try {
      return await this.api.post<ClaimedLinkIntent>("/api/v1/link-intents/claim", { intent: intent.intent });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) this.clear();
      throw error;
    }
  }

  /** Hide immediately, but retain the opaque token until the server confirms deletion. */
  complete(): void {
    const intent = this.freshIntent(true);
    if (!intent) return;
    const completing: StoredLinkIntent = { ...intent, state: "completing" };
    this.persist(completing);
    this.intent.set(completing);
    void this.finishCompletion(completing);
  }

  clear(): void {
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
    }
    this.intent.set(null);
  }

  private freshIntent(includeCompleting = false): StoredLinkIntent | null {
    const record = this.intent();
    if (!record) return null;
    if (this.validExpiry(record.expiresAt) && (includeCompleting || record.state === "active")) return record;
    this.clear();
    return null;
  }

  private read(): StoredLinkIntent | null {
    if (typeof window === "undefined") return null;
    return this.readStorage(window.localStorage, "local") ?? this.readStorage(window.sessionStorage, "session");
  }

  private readStorage(storage: Storage, storageKind: StoredLinkIntent["storage"]): StoredLinkIntent | null {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<LinkIntentReceipt> & { state?: unknown };
      if (!value.intent || !TOKEN_PATTERN.test(value.intent) || !this.validExpiry(value.expiresAt)) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      const state = value.state === "completing" ? "completing" : "active";
      return { intent: value.intent, expiresAt: value.expiresAt!, storage: storageKind, state };
    } catch {
      return null;
    }
  }

  private validExpiry(value: string | undefined): string | null {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) && time > Date.now() ? new Date(time).toISOString() : null;
  }

  private persist(record: StoredLinkIntent): void {
    if (typeof window === "undefined" || record.storage === "memory") return;
    const payload = JSON.stringify({ intent: record.intent, expiresAt: record.expiresAt, state: record.state });
    try {
      const target = record.storage === "local" ? window.localStorage : window.sessionStorage;
      target.setItem(STORAGE_KEY, payload);
      return;
    } catch {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.sessionStorage.setItem(STORAGE_KEY, payload);
        record.storage = "session";
      } catch {
        record.storage = "memory";
      }
    }
  }

  private async finishCompletion(record: StoredLinkIntent): Promise<void> {
    if (!this.validExpiry(record.expiresAt)) {
      this.clear();
      return;
    }
    try {
      await this.api.post<{ ok: true }>("/api/v1/link-intents/complete", { intent: record.intent });
      if (this.intent()?.intent === record.intent) this.clear();
    } catch (error) {
      // A 404 means the server already completed or expired it. Other errors
      // keep only the opaque token for a later same-browser retry.
      if (error instanceof ApiRequestError && error.status === 404 && this.intent()?.intent === record.intent) {
        this.clear();
      }
    }
  }
}
