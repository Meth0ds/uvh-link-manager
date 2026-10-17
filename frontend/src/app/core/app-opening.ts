import {
  boolean,
  boundedArray,
  httpUrl,
  integer,
  invalid,
  nullableText,
  record,
  text,
} from "./services/response-decoder-helpers";

export type AppProvider = "spotify" | "youtube" | "google_maps" | "apple_maps";
export type AppOpeningSpec =
  | { version: 1; kind: "provider"; provider: AppProvider; url: string }
  | { version: 1; kind: "native"; profileId: string; route: string };
export interface AppProfile {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  iosAppId: string | null;
  androidPackage: string | null;
  androidFingerprints: string[];
  routePrefixes: string[];
}
export const APP_PROVIDERS: {
  id: AppProvider;
  name: string;
  example: string;
  help: string;
}[] = [
  {
    id: "spotify",
    name: "Spotify",
    example: "https://open.spotify.com/track/…",
    help: $localize`:@@ui.f360268ab65628:Canción, álbum, artista, lista o episodio.`,
  },
  {
    id: "youtube",
    name: "YouTube",
    example: "https://www.youtube.com/watch?v=…",
    help: $localize`:@@ui.9c0056ec5d47ec:Un vídeo o una lista de reproducción.`,
  },
  {
    id: "google_maps",
    name: "Google Maps",
    example: "https://www.google.com/maps/search/?api=1&query=…",
    help: $localize`:@@ui.f11265c9161c3c:URL de Maps con api=1, de búsqueda o ruta.`,
  },
  {
    id: "apple_maps",
    name: "Apple Maps",
    example: "https://maps.apple.com/?q=…",
    help: $localize`:@@ui.4d6c7f75d0afbb:Un lugar o una ruta de Apple Maps.`,
  },
];
function profileIdentifier(value: unknown): string {
  const id = text(value, "app profile id", 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    invalid("app profile id");
  return id;
}
export function decodeAppOpening(value: unknown): AppOpeningSpec | null {
  if (value === null) return null;
  const s = record(value, "app opening");
  if (s["version"] !== 1) invalid("app opening version");
  if (s["kind"] === "provider") {
    const provider = text(s["provider"], "provider", 20);
    if (!APP_PROVIDERS.some((p) => p.id === provider)) invalid("provider");
    const url = httpUrl(s["url"], "provider URL");
    const host = new URL(url).hostname;
    const hosts: Record<string, string[]> = {
      spotify: ["open.spotify.com"],
      youtube: ["www.youtube.com"],
      google_maps: ["www.google.com"],
      apple_maps: ["maps.apple.com"],
    };
    if (!url.startsWith("https://") || !hosts[provider].includes(host))
      invalid("provider URL");
    return {
      version: 1,
      kind: "provider",
      provider: provider as AppProvider,
      url,
    };
  }
  if (s["kind"] !== "native") invalid("app opening kind");
  const profileId = profileIdentifier(s["profileId"]);
  const route = text(s["route"], "app route", 500);
  if (
    !/^[0-9a-f-]{36}$/i.test(profileId) ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(route)
  )
    invalid("app route");
  return { version: 1, kind: "native", profileId, route };
}
export function decodeAppProfileResponse(value: unknown): {
  profile: AppProfile | null;
  domainReady: boolean;
} {
  const s = record(value, "app profile response");
  const p = s["profile"] === null ? null : record(s["profile"], "app profile");
  return {
    domainReady: boolean(s["domainReady"], "domain ready"),
    profile:
      p === null
        ? null
        : {
            id: profileIdentifier(p["id"]),
            version: integer(p["version"], "app profile version", 1),
            name: text(p["name"], "app name", 120),
            enabled: boolean(p["enabled"], "app enabled"),
            iosAppId: nullableText(p["iosAppId"], "Apple identifier", 255),
            androidPackage: nullableText(
              p["androidPackage"],
              "Android package",
              255,
            ),
            androidFingerprints: boundedArray(
              p["androidFingerprints"],
              "fingerprints",
              10,
            ).map((v) => text(v, "fingerprint", 95)),
            routePrefixes: boundedArray(
              p["routePrefixes"],
              "route prefixes",
              20,
            ).map((v) => text(v, "route prefix", 200)),
          },
  };
}
export function recommendedLinkUrl(link: {
  shortUrl: string;
  shareUrl?: string;
}): string {
  return link.shareUrl ?? link.shortUrl;
}
