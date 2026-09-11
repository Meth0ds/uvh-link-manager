import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewChild, afterNextRender, computed, inject, signal } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatButtonModule } from "@angular/material/button";
import { ClipboardModule } from "@angular/cdk/clipboard";
import { LegalShellComponent } from "../legal/legal-shell.component";

/**
 * Public, versioned operational guidance. Keep these instructions aligned with
 * the public API contract whenever signing or delivery semantics change.
 */
@Component({
  selector: "app-help",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LegalShellComponent, MatFormFieldModule, MatInputModule, MatIconModule, MatExpansionModule, MatButtonModule, ClipboardModule],
  templateUrl: "./help.component.html",
  styleUrl: "./help.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpComponent {
  @ViewChild("guideSearch") private guideSearch?: ElementRef<HTMLInputElement>;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly corpus = signal<Record<string, string>>(Object.create(null) as Record<string, string>);
  readonly guideVersion = "2026-09-08";
  readonly query = signal("");
  readonly hasQuery = computed(() => this.query().trim().length > 0);
  readonly copyMessage = signal("");
  private copyTimer?: ReturnType<typeof setTimeout>;
  readonly fragmentMatch = { paths: "exact", fragment: "exact", queryParams: "ignored", matrixParams: "ignored" } as const;
  readonly chapters = [
    { id: "links", title: "Publicar y mantener un enlace", summary: "Del alias al destino: reglas, campañas, pausas y comprobaciones antes de compartir.", tags: "crear editar cambiar destino reglas UTM pausa papelera QR campaña" },
    { id: "domains", title: "Conectar tu dominio", summary: "Qué configurar en tu proveedor DNS y qué revisar antes de publicar por HTTPS.", tags: "DNS TLS certificado verificación proveedor" },
    { id: "team", title: "Trabajar en equipo", summary: "Elige el workspace correcto y entiende qué permite cada rol.", tags: "workspace propietario owner admin editor viewer permisos invitación" },
    { id: "analytics", title: "Leer la analítica con criterio", summary: "Entiende las diferencias entre clics, personas y conversiones en tu sitio.", tags: "clics visitas robots métricas UTM estadísticas" },
    { id: "api", title: "Conectar con la API", summary: "Una primera petición de lectura, ámbitos del token y respuestas de error.", tags: "token bearer integración scopes programación permisos 401 403 422 429" },
    { id: "webhooks", title: "Recibir webhooks", summary: "Comprueba firmas, guarda los eventos y evita efectos duplicados.", tags: "eventos firma HMAC reintentos entrega duplicados timestamp" },
    { id: "troubleshooting", title: "Resolver los problemas habituales", summary: "Acceso, protección antiabuso, enlaces que no abren y recursos que no aparecen.", tags: "error login registro captcha acceso protección antiabuso ayuda entrar iniciar sesión acceder no puedo" },
  ];
  readonly starts = [
    { id: "links", icon: "link", label: "Quiero compartir un enlace", detail: "Crear, revisar y cambiar el destino." },
    { id: "domains", icon: "language", label: "Quiero usar mi dominio", detail: "DNS, verificación y conexión HTTPS." },
    { id: "troubleshooting", icon: "key", label: "No puedo entrar o editar", detail: "Acceso, hCaptcha y permisos." },
    { id: "api", icon: "terminal", label: "Estoy conectando una herramienta", detail: "Tokens de API y eventos de webhook." },
  ];
  readonly problems = [
    { title: "La protección antiabuso no se completa", steps: ["Deja cargar el formulario. Si el reto ha caducado, complétalo de nuevo.", "Comprueba si una extensión o el navegador está bloqueando el proveedor del reto.", "Si aparece un aviso de indisponibilidad, reintenta la carga. No hay un acceso alternativo sin protección."], next: "Si persiste, anota la hora y el mensaje exacto, sin incluir contraseñas ni códigos.", id: "troubleshooting" },
    { title: "El enlace no abre el destino", steps: ["Comprueba el alias y el dominio de la dirección compartida.", "Revisa estado, caducidad, límites y reglas en el workspace del enlace.", "Si usa un dominio propio, revisa también el diagnóstico de DNS y TLS."], next: "No cambies el alias de una dirección que ya has impreso para intentar reparar su destino.", id: "links" },
    { title: "Faltan enlaces o no puedo editar", steps: ["Comprueba qué workspace tienes seleccionado.", "Revisa tu rol: una persona con acceso de consulta no puede editar.", "Pide a quien administra el espacio que revise tu pertenencia y los permisos."], next: "No hace falta crear otra cuenta para cambiar de workspace.", id: "team" },
    { title: "Mi integración recibe el mismo evento varias veces", steps: ["Compara el event_id de las entregas, no solo el tipo de evento.", "Comprueba que tu receptor persiste el evento antes de responder con HTTP 2xx.", "Deduplica el efecto por event_id, también cuando solicites un reenvío manual."], next: "La entrega es al menos una vez. Recibir un duplicado no implica un evento nuevo.", id: "webhooks" },
  ];
  // Search the guide's actual local content plus synonyms. No query leaves the
  // browser, and no account data or external index is loaded. Interpolation
  // renders results as text; never construct highlighted HTML from user input.
  readonly matchingChapters = computed(() => {
    const words = this.normalize(this.query()).trim().split(/\s+/).filter(Boolean);
    return this.chapters.filter((chapter) => words.every((word) => this.normalize(`${chapter.title} ${chapter.summary} ${chapter.tags} ${this.corpus()[chapter.id] ?? ""}`).includes(word)));
  });
  readonly requestExample = "GET /api/v1/public/links HTTP/1.1\nAuthorization: Bearer <tu-token>\nAccept: application/json";
  readonly signatureExample = "X-UVH-Signature: t=<milisegundos>,v1=<hmac-hex>";

  constructor() {
    afterNextRender(() => {
      const content: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const chapter of this.chapters) {
        content[chapter.id] = this.host.nativeElement.querySelector(`#${chapter.id}`)?.textContent ?? "";
      }
      this.corpus.set(content);
    });
    inject(DestroyRef).onDestroy(() => { if (this.copyTimer !== undefined) clearTimeout(this.copyTimer); });
  }

  search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.query.set("");
    this.guideSearch?.nativeElement.focus();
  }

  @HostListener("document:keydown", ["$event"])
  focusSearch(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing
      || target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
    event.preventDefault();
    this.guideSearch?.nativeElement.focus();
  }

  copied(success: boolean): void {
    this.copyMessage.set(success ? "Ejemplo copiado. Sustituye los marcadores de posición en tu entorno privado." : "No se pudo copiar. Puedes seleccionar el texto del ejemplo.");
    if (this.copyTimer !== undefined) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copyMessage.set(""), 5000);
  }

  private normalize(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
}
