import { ApiRequestError } from "../../core/services/api.service";
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { AppOpeningService } from "../../core/services/app-opening.service";
import { LatestRequest } from "../../core/services/latest-request";
import {
  APP_PROVIDERS,
  type AppOpeningSpec,
  type AppProfile,
  type AppProvider,
} from "../../core/app-opening";

@Component({
  selector: "app-app-opening-editor",
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule],
  templateUrl: "./app-opening-editor.component.html",
  styleUrl: "./app-opening-editor.component.scss",
})
export class AppOpeningEditorComponent {
  readonly spec = model<AppOpeningSpec | null>(null);
  readonly validity = output<boolean>();
  readonly validation = computed(() => {
    const s = this.spec();
    if (
      !s ||
      (s.kind === "native" && !this.apps.native()) ||
      (s.kind === "provider" && !this.apps.providers())
    )
      return "";
    if (s.kind === "native") {
      const p = this.profile();
      if (!p || p.id !== s.profileId)
        return "La app no está disponible para este dominio. Selecciona otro dominio o utiliza Solo web.";
      return /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(s.route) &&
        p.routePrefixes.some(
          (v) => s.route.startsWith(v) || s.route === v.slice(0, -1),
        )
        ? ""
        : "Escribe una ruta dentro de los prefijos permitidos, sin parámetros ni fragmentos.";
    }
    if (!s.url.trim())
      return s.provider.endsWith("_maps")
        ? "Escribe el lugar o el destino de la ruta."
        : "Introduce la URL HTTPS del contenido que quieres abrir.";
    try {
      const u = new URL(s.url);
      const hosts = {
        spotify: ["open.spotify.com"],
        youtube: [
          "www.youtube.com",
          "youtube.com",
          "m.youtube.com",
          "youtu.be",
        ],
        google_maps: ["www.google.com", "google.com"],
        apple_maps: ["maps.apple.com"],
      };
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        u.hash ||
        !hosts[s.provider].includes(u.hostname)
      )
        return "Usa una URL HTTPS oficial del servicio, sin credenciales ni fragmentos.";
      if (s.provider.endsWith("_maps") && !this.mapDetails().destination.trim())
        return "Escribe el lugar o el destino de la ruta.";
      return "";
    } catch {
      return "Introduce una URL HTTPS válida del servicio seleccionado.";
    }
  });
  readonly domainId = input<number | null>(null);
  readonly domain = input("");
  readonly alias = input("");
  readonly webUrl = input("");
  readonly apps = inject(AppOpeningService);
  readonly providers = APP_PROVIDERS;
  readonly expanded = signal(false);
  readonly profile = signal<AppProfile | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly retry = signal(0);
  readonly platform = signal<"ios" | "android" | "desktop">("ios");
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly provider = computed(
    () =>
      this.providers.find(
        (p) =>
          p.id ===
          (this.spec()?.kind === "provider"
            ? (this.spec() as Extract<AppOpeningSpec, { kind: "provider" }>)
                .provider
            : "spotify"),
      )!,
  );
  readonly providerUrl = computed(() => {
    const s = this.spec();
    return s?.kind === "provider" ? s.url : "";
  });
  readonly mapDetails = computed(() => {
    const defaults = {
      mode: "place" as "place" | "route",
      destination: "",
      origin: "",
      travel: "",
    };
    try {
      const u = new URL(this.providerUrl());
      const apple = this.provider().id === "apple_maps";
      const mode = (
        apple ? u.searchParams.has("daddr") : u.pathname.includes("/dir")
      )
        ? "route"
        : "place";
      return {
        mode: mode as "place" | "route",
        destination:
          u.searchParams.get(
            mode === "route"
              ? apple
                ? "daddr"
                : "destination"
              : apple
                ? "q"
                : "query",
          ) ??
          u.searchParams.get("ll") ??
          "",
        origin: u.searchParams.get(apple ? "saddr" : "origin") ?? "",
        travel: u.searchParams.get(apple ? "dirflg" : "travelmode") ?? "",
      };
    } catch {
      return defaults;
    }
  });
  updateMap(
    field: "mode" | "destination" | "origin" | "travel",
    value: string,
  ) {
    const d = { ...this.mapDetails(), [field]: value };
    const apple = this.provider().id === "apple_maps";
    const url = new URL(
      apple
        ? "https://maps.apple.com/"
        : "https://www.google.com/maps/" +
          (d.mode === "route" ? "dir/" : "search/"),
    );
    // Keep official parameters supplied through the API (for example route
    // waypoints) when editing an unrelated field. A deliberate mode change
    // starts a new place/route configuration.
    if (this.mapDetails().mode === d.mode) {
      try {
        const previous = new URL(this.providerUrl());
        if (previous.hostname === url.hostname)
          previous.searchParams.forEach((v, k) => url.searchParams.set(k, v));
      } catch {
        /* First draft has no provider URL yet. */
      }
    }
    if (field === "destination") {
      url.searchParams.delete("destination_place_id");
      url.searchParams.delete("query_place_id");
      if (apple) {
        url.searchParams.delete("ll");
        url.searchParams.delete("address");
      }
    }
    if (field === "origin") url.searchParams.delete("origin_place_id");
    if (!apple) url.searchParams.set("api", "1");
    url.searchParams.set(
      d.mode === "route"
        ? apple
          ? "daddr"
          : "destination"
        : apple
          ? "q"
          : "query",
      d.destination,
    );
    if (d.mode === "route" && d.origin.trim())
      url.searchParams.set(apple ? "saddr" : "origin", d.origin);
    else url.searchParams.delete(apple ? "saddr" : "origin");
    if (d.mode === "route" && d.travel)
      url.searchParams.set(apple ? "dirflg" : "travelmode", d.travel);
    else url.searchParams.delete(apple ? "dirflg" : "travelmode");
    this.setUrl(url.href);
  }
  readonly route = computed(() => {
    const s = this.spec();
    return s?.kind === "native" ? s.route : "";
  });
  readonly summary = computed(() => {
    const s = this.spec();
    return s?.kind === "provider"
      ? this.provider().name
      : s?.kind === "native"
        ? "App del workspace"
        : "Sin configurar";
  });
  constructor() {
    void this.apps.capabilities();
    effect(() => this.validity.emit(this.validation() === ""));
    effect(() => {
      const context = this.apps.context();
      const id = this.domainId();
      const enabled = this.apps.native();
      this.retry();
      const key = JSON.stringify([context, id, enabled]);
      const r = this.requests.begin(key);
      this.profile.set(null);
      this.loading.set(enabled && id !== null);
      this.error.set("");
      if (id !== null && enabled)
        void this.apps
          .profile(id, r.signal)
          .then((v) => {
            if (
              this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              this.profile.set(
                v.domainReady && v.profile?.enabled ? v.profile : null,
              );
          })
          .catch((e) => {
            if (
              this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              this.error.set(
                e instanceof ApiRequestError
                  ? e.message
                  : "No se pudo cargar la app de este dominio.",
              );
          })
          .finally(() => {
            if (
              this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              this.loading.set(false);
          });
    });
    effect(() => {
      if (this.spec()) untracked(() => this.expanded.set(true));
    });
  }
  retryLoad() {
    this.retry.update((v) => v + 1);
  }
  selectPlatform(p: string) {
    if (p === "ios" || p === "android" || p === "desktop") this.platform.set(p);
  }
  choose(kind: "provider" | "native" | "off") {
    if (kind === "off") this.spec.set(null);
    else if (kind === "provider")
      this.spec.set({ version: 1, kind, provider: "spotify", url: "" });
    else {
      const p = this.profile();
      if (p)
        this.spec.set({
          version: 1,
          kind,
          profileId: p.id,
          route: p.routePrefixes[0] ?? "/",
        });
    }
  }
  setProvider(id: string) {
    if (this.providers.some((p) => p.id === id))
      this.spec.set({
        version: 1,
        kind: "provider",
        provider: id as AppProvider,
        url: "",
      });
  }
  setUrl(url: string) {
    const s = this.spec();
    if (s?.kind === "provider") this.spec.set({ ...s, url });
  }
  setRoute(route: string) {
    const s = this.spec();
    if (s?.kind === "native") this.spec.set({ ...s, route });
  }
  platformCopy(): string {
    if (this.platform() === "desktop")
      return "Continuará con el destino web. No se necesita una aplicación.";
    const s = this.spec();
    if (s?.kind === "native") {
      const p = this.profile();
      const supported =
        this.platform() === "ios" ? p?.iosAppId : p?.androidPackage;
      return supported
        ? "El sistema podrá abrir la app. La app comprobará el acceso con UVH antes de mostrar el contenido."
        : "Esta plataforma no está configurada. Se ofrecerá la alternativa web.";
    }
    return "Podrá abrir el servicio si el dispositivo lo permite. Si hace falta, se mostrará un botón y una alternativa web.";
  }
}
