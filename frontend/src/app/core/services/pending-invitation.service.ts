import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "uvh.pending-invitation.v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingInvitation {
  token: string;
  expiresAt: number;
}

/** Same-browser handoff for invitation bearers; never stores invite metadata. */
@Injectable({ providedIn: "root" })
export class PendingInvitationService {
  private fallback: PendingInvitation | null = null;
  readonly persistent = signal(true);

  capture(token: string, expiresAt?: string | null): void {
    if (!TOKEN_PATTERN.test(token)) return;
    const advertisedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    const value = {
      token,
      expiresAt: Number.isFinite(advertisedExpiry)
        ? Math.min(advertisedExpiry, Date.now() + TTL_MS)
        : Date.now() + TTL_MS,
    };
    if (value.expiresAt <= Date.now()) {
      this.clear();
      return;
    }
    this.fallback = value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      this.persistent.set(true);
    } catch {
      this.persistent.set(false);
    }
  }

  token(): string {
    const value = this.read();
    return value?.token ?? "";
  }

  hasPending(): boolean {
    return this.token() !== "";
  }

  clear(): void {
    this.fallback = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      this.persistent.set(false);
    }
  }

  private read(): PendingInvitation | null {
    let value = this.fallback;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) value = JSON.parse(raw) as PendingInvitation;
    } catch {
      this.persistent.set(false);
    }
    if (!value || !TOKEN_PATTERN.test(value.token) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
      this.clear();
      return null;
    }
    this.fallback = value;
    return value;
  }
}
