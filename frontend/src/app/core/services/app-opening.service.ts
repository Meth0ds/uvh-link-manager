import { Injectable, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { SharingService } from "./sharing.service";
import { decodeAppProfileResponse, type AppProfile } from "../app-opening";
import {
  boolean,
  boundedArray,
  literal,
  record,
  httpUrl,
  text,
} from "./response-decoder-helpers";

@Injectable({ providedIn: "root" })
export class AppOpeningService {
  private readonly api = inject(ApiService);
  readonly context = inject(SharingService).context;
  readonly providers = signal(false);
  readonly native = signal(false);
  readonly resolverUrl = signal("https://uvh.es/api/v1/app-links/resolve");
  private loading?: Promise<void>;
  capabilities(): Promise<void> {
    return (this.loading ??= this.api
      .get("/api/v1/config", undefined, (v) => {
        const s = record(v, "config");
        const f =
          s["appOpeningFeatures"] === undefined
            ? {}
            : record(s["appOpeningFeatures"], "app features");
        return {
          providers: f["providers"] === true,
          native: f["native"] === true,
          resolverUrl:
            f["resolverUrl"] === undefined
              ? "https://uvh.es/api/v1/app-links/resolve"
              : httpUrl(f["resolverUrl"], "native resolver URL"),
        };
      })
      .then((f) => {
        this.providers.set(f.providers);
        this.native.set(f.native);
        this.resolverUrl.set(f.resolverUrl);
      })
      .catch(() => {
        this.loading = undefined;
      }));
  }
  profile(id: number, signal?: AbortSignal) {
    return this.api.get(
      `/api/v1/domains/${id}/app-profile`,
      undefined,
      decodeAppProfileResponse,
      { signal },
    );
  }
  save(id: number, body: Omit<AppProfile, "id">, key: string) {
    return this.api.patch(
      `/api/v1/domains/${id}/app-profile`,
      body,
      decodeAppProfileResponse,
      { "Idempotency-Key": key },
    );
  }
  diagnose(id: number) {
    return this.api.post(
      `/api/v1/domains/${id}/app-profile/diagnose`,
      {},
      (v) => {
        const s = record(v, "app diagnostic");
        return {
          domainVerified: boolean(s["domainVerified"], "verified domain"),
          deviceTest: literal(
            s["deviceTest"],
            new Set(["pending"] as const),
            "device test",
          ),
          files: boundedArray(s["files"], "association files", 2).map((v) => {
            const f = record(v, "association file");
            return {
              file: text(f["file"], "file name", 64),
              published: boolean(f["published"], "published file"),
            };
          }),
        };
      },
    );
  }
}
