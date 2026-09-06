import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiRequestError, ApiService } from "./api.service";
import { decodeClaimedLinkIntent, decodeLinkIntentReceipt } from "./link-intent-response-decoders";

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
  savedAt: number;
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
    return this.api.post<LinkIntentReceipt>("/api/v1/link-intents", { destination }, decodeLinkIntentReceipt);
  }

  /** Capture a token from the app-host URL and remove it from the route afterwards. */
  capture(intent: string, expiresAt?: string): boolean {
    if (!TOKEN_PATTERN.test(intent)) return false;
    const expires = expiresAt ? this.validExpiry(expiresAt) : new Date(Date.now() + TTL_MS).toISOString();
    if (!expires) return false;
    const savedAt = Date.now();
    const record: StoredLinkIntent = { intent, expiresAt: expires, storage: "memory", state: "active", savedAt };
    const payload = JSON.stringify({ intent, expiresAt: expires, state: "active", savedAt });

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, payload);
        record.storage = "local";
        // Cleanup is independent: a denied sessionStorage operation must not
        // downgrade a localStorage write that has already succeeded.
        try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* stale fallback is ignored below */ }
      } catch {
        try {
          window.sessionStorage.setItem(STORAGE_KEY, payload);
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
      return await this.api.post<ClaimedLinkIntent>(
        "/api/v1/link-intents/claim",
        { intent: intent.intent },
        decodeClaimedLinkIntent,
      );
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
    let local: StoredLinkIntent | null = null;
    let session: StoredLinkIntent | null = null;
    // Access to the Storage objects themselves can throw in sandboxed frames.
    try { local = this.readStorage(window.localStorage, "local"); } catch { /* storage is optional */ }
    try { session = this.readStorage(window.sessionStorage, "session"); } catch { /* storage is optional */ }
    // A local write can later become unavailable while the completing state is
    // safely persisted in sessionStorage. Never resurrect its active twin.
    if (local?.intent === session?.intent && session?.state === "completing") return session;
    if (local && session && session.savedAt > local.savedAt) return session;
    return local ?? session;
  }

  private readStorage(storage: Storage, storageKind: StoredLinkIntent["storage"]): StoredLinkIntent | null {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<LinkIntentReceipt> & { state?: unknown; savedAt?: unknown };
      if (typeof value?.intent !== "string" || typeof value.expiresAt !== "string"
        || !TOKEN_PATTERN.test(value.intent) || !this.validExpiry(value.expiresAt)
        || (value.state !== undefined && value.state !== "active" && value.state !== "completing")) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      const state = value.state === "completing" ? "completing" : "active";
      const savedAt = typeof value.savedAt === "number" && Number.isSafeInteger(value.savedAt)
        && value.savedAt > 0 && value.savedAt <= Date.now() + 5 * 60_000 ? value.savedAt : 0;
      return { intent: value.intent, expiresAt: value.expiresAt!, storage: storageKind, state, savedAt };
    } catch {
      try { storage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
      return null;
    }
  }

  private validExpiry(value: string | undefined): string | null {
    if (!value) return null;
    const time = Date.parse(value);
    // The URL parameter is untrusted. It may shorten, but never extend, the
    // server-intent lifetime retained by this browser.
    return Number.isFinite(time) && time > Date.now() && time <= Date.now() + TTL_MS
      ? new Date(time).toISOString()
      : null;
  }

  private persist(record: StoredLinkIntent): void {
    if (typeof window === "undefined" || record.storage === "memory") return;
    const payload = JSON.stringify({
      intent: record.intent, expiresAt: record.expiresAt, state: record.state, savedAt: record.savedAt,
    });
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
