import { Injectable, inject, signal } from "@angular/core";
import { ApiService } from "../core/services/api.service";
import { decodePublicConfig, type PublicConfig } from "../core/services/public-response-decoders";

/** Loads the legally public provider identity once for all legal documents. */
@Injectable({ providedIn: "root" })
export class LegalIdentityService {
  private readonly api = inject(ApiService);
  private loading: Promise<void> | null = null;
  private loaded = false;

  readonly identity = signal<PublicConfig["legalIdentity"]>(null);
  readonly ready = signal(false);

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.ready.set(false);
    this.loading = this.api.get<PublicConfig>("/api/v1/config", undefined, decodePublicConfig)
      .then((config) => {
        this.identity.set(config.legalIdentity);
        this.loaded = true;
      })
      .catch(() => {
        // Legal pages stay explicit about an unavailable identity. Production
        // cannot boot with missing values, but a transient API failure must not
        // replace them with guessed or stale text in the browser.
        this.identity.set(null);
      })
      .finally(() => {
        // A transient failure may be retried by the next legal view; successful
        // immutable public configuration remains cached for this app session.
        this.ready.set(true);
        this.loading = null;
      });
    return this.loading;
  }
}
