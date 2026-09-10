import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewChild, afterNextRender, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import { MatRippleModule } from "@angular/material/core";
import { MatExpansionModule } from "@angular/material/expansion";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { decodePublicConfig } from "../core/services/public-response-decoders";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

type ProductViewId = "publish" | "route" | "measure";

interface ProductView {
  id: ProductViewId;
  icon: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  alias: string;
  before: string;
  after: string;
  note: string;
}

@Component({
  selector: "app-landing",
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    MatIconModule,
    MatRippleModule,
    PublicThemeToggleComponent,
    MatExpansionModule,
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild("menuButton") private menuButton?: ElementRef<HTMLButtonElement>;

  readonly appUrl = signal("");
  readonly demoUrl = signal("");
  readonly demoError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly mobileOpen = signal(false);
  readonly scrolled = signal(false);
  readonly pageProgress = signal(0);
  // The illustration is a local demonstration, never a published link or a
  // reserved alias. Switching it does not send the visitor's URL anywhere.
  readonly destinationChanged = signal(false);
  readonly year = new Date().getFullYear();
  readonly destinationPreview = computed(() => this.previewDestination(this.demoUrl()));
  readonly destinationReady = computed(() => this.destinationPreview()?.valid === true);

  readonly activeProductViewId = signal<ProductViewId>("publish");
  readonly activeProductView = computed(() => this.productViews.find((view) => view.id === this.activeProductViewId())!);

  readonly productViews: ProductView[] = [
    {
      id: "publish",
      label: "Una carta impresa",
      icon: "add_link",
      title: "Cambian los platos. Las mesas siguen puestas.",
      description: "Has impreso la dirección de tu carta en cada mesa. Cuando llegue la nueva temporada, cambia el destino en UVH y conserva el enlace que tus clientes ya tienen.",
      bullets: ["Elige un alias que puedas leer en voz alta: /carta.", "Publica el enlace y úsalo en tus materiales.", "Actualiza el destino cuando cambie el menú."],
      alias: "go.turestaurante.es/carta",
      before: "/carta-verano.pdf",
      after: "/carta-otono.pdf",
      note: "Misma dirección impresa. Nueva carta al abrirla.",
    },
    {
      id: "route",
      label: "Un evento bilingüe",
      icon: "route",
      title: "Un cartel. Cada lector, a su programa.",
      description: "Comparte una sola dirección para el evento. Una regla de idioma puede llevar al programa en español; el destino principal atiende a quienes no coincidan con esa regla.",
      bullets: ["Define el programa general como destino principal.", "Añade una regla para el idioma español.", "Ordena las reglas: se aplica la primera que coincida."],
      alias: "go.tuevento.es/programa",
      before: "/programme",
      after: "/es/programa",
      note: "Idioma es → programa en español. Sin coincidencia → programa general.",
    },
    {
      id: "measure",
      label: "Una newsletter",
      icon: "query_stats",
      title: "Después de enviar, aún queda trabajo.",
      description: "Prepara un enlace para tu boletín y consulta sus clics por periodo. Si la página de destino se mueve, puedes corregirla sin reenviar el correo a toda la lista.",
      bullets: ["Usa un enlace específico para cada envío.", "Consulta cuándo recibe clics y desde qué dispositivos.", "Corrige el destino si cambia la página de la campaña."],
      alias: "uvh.es/edicion-septiembre",
      before: "/novedades-septiembre",
      after: "/coleccion/septiembre",
      note: "El correo ya está enviado. El destino sigue siendo editable.",
    },
  ];

  readonly operations = [
    { icon: "language", guide: "domains", title: "Dominios propios", text: "Comparte go.tumarca.es en lugar de una dirección ajena. Requiere un subdominio con CNAME directo, verificación DNS y activación TLS." },
    { icon: "key", guide: "api", title: "API tokens", text: "Crea enlaces desde tus propias herramientas. Limita los permisos de cada token, define su caducidad y revócalo cuando deje de hacer falta." },
    { icon: "webhook", guide: "webhooks", title: "Webhooks", text: "Recibe eventos en tu sistema y revisa el historial de entregas. Las firmas y los reintentos te ayudan a comprobar qué has recibido." },
  ];

  readonly faqs = [
    {
      q: "¿Pegar una URL publica el enlace?",
      a: "No. Primero preparas el destino. Para guardar el enlace necesitas una cuenta y verificar tu email. Conservamos la URL durante 24 horas para que puedas retomar el formulario después de entrar.",
    },
    {
      q: "¿Qué puedo cambiar después de compartirlo?",
      a: "Puedes editar el destino, las reglas y los límites, o pausar el enlace. Para conservar la dirección que ya has compartido, mantén el mismo alias y dominio. Necesitas un rol con permiso de edición.",
    },
    {
      q: "¿Una contraseña en el enlace protege también el archivo?",
      a: "Protege el paso por UVH, no el acceso directo al destino. Quien conozca la URL final podría abrirla sin pasar por el enlace corto. Para contenido privado, configura también permisos en el servicio donde lo alojas.",
    },
    {
      q: "¿Puedo usar mi propio dominio?",
      a: "Sí, con un subdominio como go.tumarca.es. Necesitas acceso a su DNS para configurar el CNAME directo y la verificación de propiedad. El panel muestra el estado de DNS y TLS antes de activarlo.",
    },
    {
      q: "¿Los clics equivalen a personas?",
      a: "No. Una persona puede abrir un enlace varias veces y también pueden acceder sistemas automáticos. Los pseudónimos de visitante rotan diariamente: no son una cifra de personas únicas entre varios días. UVH tampoco confirma una compra o una conversión en la web de destino.",
    },
    {
      q: "¿Qué ocurre cuando caduca o alcanza su límite?",
      a: "El enlace deja de llevar al destino habitual. Puedes configurar un destino alternativo para los casos admitidos, como caducidad o límite de clics. Revisa esa configuración antes de publicar una promoción con fecha de fin.",
    },
  ];

  constructor() {
    this.appUrl.set(this.currentOrigin());
    this.api
      .get<{ appUrl: string }>("/api/v1/config", undefined, decodePublicConfig)
      .then((config) => this.appUrl.set(this.resolveAppUrl(config.appUrl)))
      .catch(() => undefined);
    afterNextRender(() => this.installRevealObserver());
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove("uvh-menu-open");
    });
  }

  @HostListener("window:scroll")
  onWindowScroll(): void {
    const view = this.document.defaultView;
    const offset = view?.scrollY ?? 0;
    const travel = this.document.documentElement.scrollHeight - (view?.innerHeight ?? 0);
    this.scrolled.set(offset > 18);
    this.pageProgress.set(travel > 0 ? Math.min(1, Math.max(0, offset / travel)) : 0);
  }

  @HostListener("window:resize")
  onWindowResize(): void {
    if ((this.document.defaultView?.innerWidth ?? 0) > 940 && this.mobileOpen()) this.closeMobileMenu();
    this.onWindowScroll();
  }

  /** Observe once and disconnect on teardown. The observer adds motion only;
   * it never owns content visibility, even in a throttled background tab.
   */
  private installRevealObserver(): void {
    const view = this.document.defaultView;
    if (!view || typeof IntersectionObserver === "undefined"
      || (typeof view.matchMedia === "function" && view.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("reveal-pending");
        entry.target.classList.add("reveal-enter");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    const elements = this.host.nativeElement.querySelectorAll<HTMLElement>(".section-heading, .case-study, .guide-heading, .guide-notes article, .team-intro, .workspace-sheet, .operations-list article, .faq-intro, .faq-list, .closing-inner");
    elements.forEach((element) => {
      if (element.getBoundingClientRect().top > view.innerHeight) {
        element.classList.add("scroll-reveal", "reveal-pending");
        observer.observe(element);
      }
    });
    this.destroyRef.onDestroy(() => observer.disconnect());
    this.onWindowScroll();
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
    if (this.submitting()) return;
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
      const view = this.document.defaultView;
      const reducedMotion = typeof view?.matchMedia === "function"
        && view.matchMedia("(prefers-reduced-motion: reduce)").matches;
      input?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
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
