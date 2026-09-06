import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewChild, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatIconModule } from "@angular/material/icon";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { decodePublicConfig } from "../core/services/public-response-decoders";
import { ThemeToggleComponent } from "../core/theme-toggle.component";

type ProductViewId = "publish" | "route" | "measure";

interface ProductView {
  id: ProductViewId;
  icon: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
}

@Component({
  selector: "app-landing",
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    ThemeToggleComponent,
  ],
  templateUrl: "./landing.component.html",
  styleUrl: "./landing.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent {
  private readonly api = inject(ApiService);
  private readonly intents = inject(PendingLinkIntentService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild("menuButton") private menuButton?: ElementRef<HTMLButtonElement>;

  readonly appUrl = signal("");
  readonly demoUrl = signal("");
  readonly demoError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly mobileOpen = signal(false);
  readonly scrolled = signal(false);
  readonly year = new Date().getFullYear();
  readonly destinationPreview = computed(() => this.previewDestination(this.demoUrl()));
  readonly destinationReady = computed(() => this.destinationPreview()?.valid === true);

  readonly activeProductViewId = signal<ProductViewId>("publish");
  readonly activeProductView = computed(() => this.productViews.find((view) => view.id === this.activeProductViewId())!);

  readonly productViews: ProductView[] = [
    {
      id: "publish",
      label: "Crear",
      icon: "add_link",
      title: "Publica con una configuración preparada para cambiar.",
      description: "El enlace nace dentro de tu workspace con el alias, dominio y ciclo de vida que necesita; no como una URL desechable.",
      bullets: ["Alias y dominio personalizado", "UTM, etiquetas y notas", "Programación, caducidad y límite de clics"],
    },
    {
      id: "route",
      label: "Dirigir",
      icon: "route",
      title: "Decide el destino en el momento de cada redirección.",
      description: "Ordena reglas por prioridad y conserva un destino principal como fallback cuando ninguna condición coincide.",
      bullets: ["País, idioma y dispositivo", "Sistema, horario y referente", "Campaña y destino alternativo"],
    },
    {
      id: "measure",
      label: "Medir",
      icon: "query_stats",
      title: "Lee la actividad desde el mismo lugar donde operas el enlace.",
      description: "Cambia el periodo y recorre la serie temporal, los enlaces destacados y las dimensiones que ya entrega la API.",
      bullets: ["Clics y visitantes únicos", "Países, dispositivos y navegadores", "Referentes, campañas y sistemas"],
    },
  ];

  readonly capabilities = [
    { icon: "link", number: "01", title: "Crear", text: "Destino, alias, dominio, UTM y etiquetas en una sola configuración." },
    { icon: "alt_route", number: "02", title: "Dirigir", text: "Reglas priorizadas y fallback para adaptar el recorrido de cada clic." },
    { icon: "shield_lock", number: "03", title: "Proteger", text: "Contraseña, un solo uso, límites, calendario y estados operativos." },
    { icon: "monitoring", number: "04", title: "Medir", text: "Serie temporal y procedencia sin separar analítica y operación." },
  ];

  readonly operations = [
    { icon: "language", title: "Dominios propios", text: "Verificación DNS, activación y control del estado desde el workspace." },
    { icon: "groups", title: "Equipo y roles", text: "Owner, admin, editor y viewer con permisos coherentes en cada acción." },
    { icon: "key", title: "API tokens", text: "Scopes de lectura y escritura, caducidad y revocación explícita." },
    { icon: "webhook", title: "Webhooks", text: "Eventos firmados, historial de entregas, reintentos y reenvío manual." },
  ];

  readonly faqs = [
    {
      q: "¿Qué pasa cuando pego una URL?",
      a: "La guardamos de forma temporal durante 24 horas. Si necesitas crear una cuenta o iniciar sesión, la recuperaremos para abrir el formulario de creación ya rellenado.",
    },
    {
      q: "¿La URL aparece en la dirección del navegador?",
      a: "No. UVH usa un token temporal opaco entre la página pública y el panel. El destino sólo se recupera cuando tienes una sesión verificada.",
    },
    {
      q: "¿Cómo se resuelven los enlaces?",
      a: "Cada enlace responde con una redirección HTTP real desde el backend. No hay scripts intermedios entre quien hace clic y el destino.",
    },
    {
      q: "¿Puedo usar mi propio dominio?",
      a: "Sí. Puedes conectar dominios personalizados y verificarlos mediante DNS para que cada enlace salga con tu propia marca.",
    },
    {
      q: "¿Puedo cambiar el destino después de publicar?",
      a: "Sí. El enlace mantiene su alias mientras actualizas el destino, las reglas, los límites o su estado desde el panel, siempre que tu rol tenga permiso de edición.",
    },
    {
      q: "¿Qué puede medir UVH?",
      a: "El panel trabaja con clics, visitantes, serie temporal, enlaces destacados, países, dispositivos, navegadores, sistemas, referentes y campañas para el periodo seleccionado.",
    },
    {
      q: "¿Necesito una cuenta para empezar?",
      a: "Puedes pegar y comprobar una URL sin cuenta. Para guardar el enlace tendrás que entrar o registrarte; después retomaremos el borrador donde lo dejaste.",
    },
  ];

  constructor() {
    this.appUrl.set(this.currentOrigin());
    this.api
      .get<{ appUrl: string }>("/api/v1/config", undefined, decodePublicConfig)
      .then((config) => this.appUrl.set(this.resolveAppUrl(config.appUrl)))
      .catch(() => undefined);
    this.destroyRef.onDestroy(() => this.document.body.classList.remove("uvh-menu-open"));
  }

  @HostListener("window:scroll")
  onWindowScroll(): void {
    this.scrolled.set((this.document.defaultView?.scrollY ?? 0) > 18);
  }

  @HostListener("window:resize")
  onWindowResize(): void {
    if ((this.document.defaultView?.innerWidth ?? 0) > 940 && this.mobileOpen()) this.closeMobileMenu();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.mobileOpen()) this.closeMobileMenu(true);
  }

  loginHref(): string {
    return `${this.appUrl() || this.currentOrigin()}/auth`;
  }

  registerHref(): string {
    const returnTo = encodeURIComponent("/app/links");
    return `${this.appUrl() || this.currentOrigin()}/auth?mode=register&returnTo=${returnTo}`;
  }

  onUrlChange(value: string): void {
    this.demoUrl.set(value);
    if (this.demoError()) this.demoError.set(null);
  }

  toggleMobileMenu(): void {
    if (this.mobileOpen()) {
      this.closeMobileMenu(true);
    } else {
      this.openMobileMenu();
    }
  }

  openMobileMenu(): void {
    this.mobileOpen.set(true);
    this.document.body.classList.add("uvh-menu-open");
  }

  closeMobileMenu(restoreFocus = false): void {
    this.mobileOpen.set(false);
    this.document.body.classList.remove("uvh-menu-open");
    if (restoreFocus) this.document.defaultView?.requestAnimationFrame(() => this.menuButton?.nativeElement.focus());
  }

  async submitDemo(): Promise<void> {
    const destination = this.demoUrl().trim();
    if (!this.validDestination(destination)) return;

    this.submitting.set(true);
    this.demoError.set(null);
    try {
      const receipt = await this.intents.create(destination);
      const app = this.appUrl() || this.currentOrigin();
      const params = new URLSearchParams({
        mode: "register",
        returnTo: "/app/links",
        intent: receipt.intent,
      });
      this.handoffToAuth(`${app}/auth?${params.toString()}`);
    } catch (error) {
      this.demoError.set(error instanceof ApiRequestError ? error.message : "No se pudo preparar tu enlace. Inténtalo de nuevo.");
      this.submitting.set(false);
    }
  }

  focusHero(): void {
    this.closeMobileMenu();
    this.document.defaultView?.requestAnimationFrame(() => {
      const input = this.document.getElementById("hero-url") as HTMLInputElement | null;
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  selectProductView(view: ProductViewId): void {
    this.activeProductViewId.set(view);
  }

  onProductTabKeydown(event: KeyboardEvent, index: number): void {
    const lastIndex = this.productViews.length - 1;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === null) return;

    event.preventDefault();
    this.selectProductView(this.productViews[nextIndex].id);
    const tabs = (event.currentTarget as HTMLElement | null)?.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    this.document.defaultView?.requestAnimationFrame(() => tabs?.item(nextIndex!)?.focus());
  }

  /** Small seam for testing the public-to-app handoff without navigating the test runner. */
  protected handoffToAuth(target: string): void {
    window.location.assign(target);
  }

  private validDestination(raw: string): boolean {
    if (!this.previewDestination(raw)?.valid) {
      this.demoError.set("Introduce una URL http(s) válida, sin credenciales embebidas.");
      return false;
    }
    return true;
  }

  private previewDestination(raw: string): { valid: true; host: string; destination: string; alias: string } | null {
    const value = raw.trim();
    if (!value || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      const host = url.hostname.replace(/^www\./i, "");
      const candidate = url.pathname.split("/").filter(Boolean).at(-1) || host.split(".")[0] || "enlace";
      const alias = candidate.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "mi-enlace";
      return { valid: true, host, destination: `${host}${url.pathname === "/" ? "" : url.pathname}`, alias };
    } catch {
      return null;
    }
  }

  private currentOrigin(): string {
    return typeof window === "undefined" ? "" : window.location.origin;
  }

  private resolveAppUrl(raw: string): string {
    const fallback = this.currentOrigin();
    if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) return fallback;
    try {
      const url = new URL(raw, fallback);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return fallback;
      return url.origin;
    } catch {
      return fallback;
    }
  }
}
