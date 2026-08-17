import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { FormsModule } from "@angular/forms";
import { ApiService } from "../core/services/api.service";

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

@Component({
  selector: "app-landing",
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, FormsModule],
  templateUrl: "./landing.component.html",
  styleUrl: "./landing.component.scss",
})
export class LandingComponent {
  private api = inject(ApiService);

  readonly year = new Date().getFullYear();
  readonly demoUrl = signal("");
  readonly appUrl = signal("");

  constructor() {
    // Resolve the panel origin once so CTAs cross hosts correctly in production
    // (uvh.es → app.uvh.es). Falls back to same-origin /auth while loading.
    this.api
      .get<{ appUrl: string }>("/api/v1/config")
      .then((c) => this.appUrl.set(c.appUrl))
      .catch(() => {});
  }

  /** Absolute URL to the authenticated panel, honoring the resolved app host. */
  authHref(): string {
    return `${this.appUrl()}/auth?returnTo=${encodeURIComponent("/app/links")}`;
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
    // Creating links requires an authenticated, verified account.
    this.demoUrl.set("");
    window.location.href = this.authHref();
  }
}
