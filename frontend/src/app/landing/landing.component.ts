import { AfterViewInit, Component, ElementRef, inject, OnDestroy, signal, ChangeDetectionStrategy } from "@angular/core";

import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatRippleModule } from "@angular/material/core";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatTooltipModule } from "@angular/material/tooltip";
import { FormsModule } from "@angular/forms";
import { ApiService } from "../core/services/api.service";
import { ThemeService } from "../core/services/theme.service";

interface Feature {
  icon: string;
  title: string;
  text: string;
}

interface Plan {
  name: string;
  price: string;
  period: string;
  highlight: boolean;
  cta: string;
  features: string[];
}

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  initials: string;
}

@Component({
  selector: "app-landing",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatRippleModule, MatExpansionModule, MatTooltipModule, FormsModule],
  templateUrl: "./landing.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./landing.component.scss",
})
export class LandingComponent implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  readonly theme = inject(ThemeService);
  private hostElement = inject(ElementRef<HTMLElement>);
  private revealObserver?: IntersectionObserver;
  private heroSpotlightCleanup?: () => void;

  readonly year = new Date().getFullYear();
  readonly demoUrl = signal("");
  readonly appUrl = signal("");
  readonly mobileOpen = signal(false);
  readonly demoError = signal<string | null>(null);

  constructor() {
    // Keep local development on the frontend origin. The API proxy may report
    // its own backend host, which must never become a broken CTA destination.
    this.appUrl.set(this.currentOrigin());
    this.api
      .get<{ appUrl: string }>("/api/v1/config")
      .then((c) => this.appUrl.set(this.resolveAppUrl(c.appUrl)))
      .catch(() => {});
  }

  ngAfterViewInit(): void {
    this.setupHeroSpotlight();

    const revealElements = Array.from(this.hostElement.nativeElement.querySelectorAll(".reveal") as NodeListOf<HTMLElement>);
    if (!revealElements.length) return;

    if (typeof IntersectionObserver === "undefined") {
      revealElements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          this.revealObserver?.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
    );

    revealElements.forEach((element) => this.revealObserver?.observe(element));
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
    this.heroSpotlightCleanup?.();
  }

  /** Moves the hero spotlight with the pointer (skipped for reduced motion). */
  private setupHeroSpotlight(): void {
    const hero = this.hostElement.nativeElement.querySelector(".hero") as HTMLElement | null;
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (event: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
      hero.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    };

    hero.addEventListener("pointermove", onMove, { passive: true });
    this.heroSpotlightCleanup = () => hero.removeEventListener("pointermove", onMove);
  }

  /** Absolute URL to the authenticated panel, honoring the resolved app host. */
  authHref(destination = ""): string {
    const returnTo = destination
      ? `/app/links?destination=${encodeURIComponent(destination)}`
      : "/app/links";
    return `${this.appUrl() || this.currentOrigin()}/auth?returnTo=${encodeURIComponent(returnTo)}`;
  }

  toggleTheme(): void {
    this.theme.set(this.theme.resolved() === "dark" ? "light" : "dark");
  }

  private currentOrigin(): string {
    return typeof window === "undefined" ? "" : window.location.origin;
  }

  private resolveAppUrl(raw: string): string {
    const fallback = this.currentOrigin();
    // Dev proxy hosts must remain on the SPA origin; the API origin does not
    // serve the Angular shell in local development.
    if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
      return fallback;
    }
    try {
      const url = new URL(raw, fallback);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return fallback;
      return url.origin;
    } catch {
      return fallback;
    }
  }

  readonly features: Feature[] = [
    {
      icon: "bolt",
      title: "Enlaces al instante",
      text: "Acorta cualquier URL en un clic. Alias personalizados o aleatorios, con copia inmediata y QR listo para compartir.",
    },
    {
      icon: "query_stats",
      title: "Analítica real",
      text: "Clics, visitantes únicos, países, dispositivos, navegadores y referentes. Sin píxeles fantasma: métricas de tu propio backend.",
    },
    {
      icon: "call_split",
      title: "Redirección inteligente",
      text: "Reglas por país, idioma, dispositivo, sistema operativo, horario, referente o campaña con destino de respaldo.",
    },
    {
      icon: "shield",
      title: "Seguridad por diseño",
      text: "Sesiones con cookies HttpOnly, CSRF doble envío, rate limiting, hash de tokens y auditoría inmutable de cada acción.",
    },
    {
      icon: "language",
      title: "Tu propio dominio",
      text: "Conecta dominios personalizados con verificación real por registro DNS TXT y usa tu marca en cada enlace corto.",
    },
    {
      icon: "webhook",
      title: "Automatización",
      text: "Webhooks firmados con HMAC para cada evento de enlace y API tokens con scopes para integrar tus propios sistemas.",
    },
  ];

  readonly steps: Feature[] = [
    {
      icon: "edit_note",
      title: "Pega tu URL",
      text: "Introduce el destino y elige un alias o deja que UVH genere uno corto y seguro.",
    },
    {
      icon: "tune",
      title: "Configura el control",
      text: "Añade contraseña, límite de clics, uso único, programación, UTM o reglas de redirección.",
    },
    {
      icon: "monitoring",
      title: "Mide y optimiza",
      text: "Comparte el enlace y sigue cada clic en tiempo real desde tu panel.",
    },
  ];

  readonly plans: Plan[] = [
    {
      name: "Starter",
      price: "0 €",
      period: "para siempre",
      highlight: false,
      cta: "Crear cuenta gratis",
      features: ["500 enlaces", "1 dominio personalizado", "Analítica de 7 días", "QR incluidos", "1 workspace"],
    },
    {
      name: "Pro",
      price: "9 €",
      period: "/mes",
      highlight: true,
      cta: "Empezar con Pro",
      features: [
        "Enlaces ilimitados",
        "Dominios personalizados ilimitados",
        "Analítica de 90 días",
        "Reglas de redirección",
        "API tokens y webhooks",
        "Miembros de equipo",
      ],
    },
    {
      name: "Business",
      price: "29 €",
      period: "/mes",
      highlight: false,
      cta: "Hablar con ventas",
      features: ["Todo lo de Pro", "Roles y permisos avanzados", "Auditoría completa", "Soporte prioritario", "SLA de disponibilidad"],
    },
  ];

  readonly stats = [
    { value: "99,99%", label: "disponibilidad objetivo", icon: "verified" },
    { value: "<50 ms", label: "tiempo de resolución", icon: "bolt" },
    { value: "24/7", label: "visibilidad de tu tráfico", icon: "monitoring" },
    { value: "100%", label: "datos de tu propio backend", icon: "storage" },
  ];

  readonly testimonials: Testimonial[] = [
    {
      quote:
        "Pasamos de enlaces sin control a saber exactamente qué campaña trae tráfico y desde qué país. Las reglas de redirección nos ahorran horas cada semana.",
      name: "Lucía Fernández",
      role: "Growth Lead · Northwind",
      initials: "LF",
    },
    {
      quote:
        "El enlace se resuelve con una redirección real y la analítica es nuestra. Nada de intermediarios ni píxeles de terceros entre la campaña y el cliente.",
      name: "Marc Vidal",
      role: "CTO · Sotano Studio",
      initials: "MV",
    },
    {
      quote:
        "Verificar nuestro dominio fue cuestión de minutos y la API nos permitió generar enlaces dinámicos desde el propio producto. Impecable.",
      name: "Elena Roca",
      role: "Product Manager · Linq",
      initials: "ER",
    },
  ];

  readonly comparison = {
    features: [
      { label: "Redirección HTTP real (302)", uvh: true, other: false },
      { label: "Analítica sin píxeles de terceros", uvh: true, other: false },
      { label: "Dominios propios con verificación TXT", uvh: true, other: true },
      { label: "Reglas por país, idioma y dispositivo", uvh: true, other: false },
      { label: "Webhooks firmados y API con scopes", uvh: true, other: false },
      { label: "MFA y auditoría de acciones sensibles", uvh: true, other: false },
      { label: "Límites de clics y uso único", uvh: true, other: true },
      { label: "Sin anuncios ni branding ajeno", uvh: true, other: false },
    ],
  };

  readonly faqs = [
    {
      q: "¿Cómo se resuelven los enlaces?",
      a: "Cada enlace se resuelve con una redirección HTTP real (302) desde el backend. No hay JavaScript que intermedie: funciona en cualquier cliente, correo o aplicación.",
    },
    {
      q: "¿Qué ocurre con la privacidad de mis clics?",
      a: "No almacenamos IPs en claro. Los visitantes se identifican con un hash salado de IP + user-agent que rota diariamente, y puedes configurar el periodo de retención de la analítica.",
    },
    {
      q: "¿Puedo proteger un enlace con contraseña?",
      a: "Sí. Marca la opción de contraseña al crear el enlace y quien lo abra deberá introducirla antes de ser redirigido. También puedes limitar clics o hacerlo de uso único.",
    },
    {
      q: "¿Cómo verifico un dominio propio?",
      a: "Añades el dominio en el panel y UVH te da un registro DNS TXT. Cuando el registro propague, pulsas verificar y el dominio queda activo para tus enlaces.",
    },
    {
      q: "¿Puedo integrar UVH con mis sistemas?",
      a: "Sí. Dispones de API tokens con scopes (links, analytics, domains) y webhooks firmados con HMAC que recibes en tu propio endpoint.",
    },
  ];

  submitDemo(): void {
    const raw = this.demoUrl().trim();
    if (raw) {
      try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || raw.length > 2048) throw new Error("invalid");
      } catch {
        this.demoError.set("Introduce una URL http(s) válida, sin credenciales embebidas.");
        return;
      }
    }
    this.demoError.set(null);
    // Link creation requires an authenticated, verified account. Preserve the
    // destination through login so the dialog can be opened prefilled.
    window.location.assign(this.authHref(raw));
  }
}
