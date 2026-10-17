import { LocaleLinkDirective } from "../core/localisation/locale-link.directive";
import { UI_TEXT } from "../core/localisation/template-messages";
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
  imports: [LocaleLinkDirective, RouterLink, RouterLinkActive, LegalShellComponent, MatFormFieldModule, MatInputModule, MatIconModule, MatExpansionModule, MatButtonModule, ClipboardModule],
  templateUrl: "./help.component.html",
  styleUrl: "./help.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpComponent {
  readonly uiText = UI_TEXT;
  @ViewChild("guideSearch") private guideSearch?: ElementRef<HTMLInputElement>;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly corpus = signal<Record<string, string>>(Object.create(null) as Record<string, string>);
  readonly guideVersion = "2026-10-08";
  readonly query = signal("");
  readonly hasQuery = computed(() => this.query().trim().length > 0);
  readonly copyMessage = signal("");
  private copyTimer?: ReturnType<typeof setTimeout>;
  readonly fragmentMatch = { paths: "exact", fragment: "exact", queryParams: "ignored", matrixParams: "ignored" } as const;
  readonly chapters = [
    { id: "links", title: $localize`:@@ui.db25e7e13f1f79:Crear y editar enlaces`, summary: $localize`:@@ui.a6e0fe32a39360:Destino, alias, reglas y comprobaciones antes de compartir.`, tags: $localize`:@@ui.1339ebc11e771f:crear editar cambiar destino reglas UTM pausa papelera QR campaña` },
    { id: "domains", title: $localize`:@@ui.fd226becda824c:Configurar un dominio`, summary: $localize`:@@ui.69d09027c613a9:Qué configurar en tu proveedor DNS y qué revisar antes de publicar por HTTPS.`, tags: $localize`:@@ui.60bd807040c4ec:DNS TLS certificado verificación proveedor` },
    { id: "team", title: $localize`:@@ui.39c4e690a2f69e:Permisos del equipo`, summary: $localize`:@@ui.774f2bf7d0a593:Elige el workspace correcto y entiende qué permite cada rol.`, tags: $localize`:@@ui.d3af276490a23c:workspace propietario owner admin editor viewer permisos invitación` },
    { id: "analytics", title: $localize`:@@ui.4e1ffd853964d8:Consultar los clics`, summary: $localize`:@@ui.791b6aacb33464:Entiende las diferencias entre clics, personas y conversiones en tu sitio.`, tags: $localize`:@@ui.cf2d19cee7f07e:analítica clics visitas robots métricas UTM estadísticas` },
    { id: "api", title: $localize`:@@ui.8151b1ea6160f5:Usar la API`, summary: $localize`:@@ui.95630a4a37c2c6:Una primera petición de lectura, ámbitos del token y respuestas de error.`, tags: $localize`:@@ui.ba6e8fb8fb180e:token bearer integración scopes programación permisos 401 403 422 429` },
    { id: "webhooks", title: $localize`:@@ui.defdd28e015573:Verificar webhooks`, summary: $localize`:@@ui.360b9ecd4050e4:Comprueba firmas, guarda los eventos y evita efectos duplicados.`, tags: $localize`:@@ui.c2d010b35a48c6:eventos firma HMAC reintentos entrega duplicados timestamp` },
    { id: "troubleshooting", title: $localize`:@@ui.5e50f44a315aa0:Resolver problemas`, summary: $localize`:@@ui.36b1bfa4bf729f:Acceso, protección antiabuso, enlaces que no abren y recursos que no aparecen.`, tags: $localize`:@@ui.5a48bc525dfeb2:error login registro captcha acceso protección antiabuso ayuda entrar iniciar sesión acceder no puedo` },
  ];
  readonly starts = [
    { id: "links", icon: "link", label: $localize`:@@ui.b3267c97a9b8ab:Crear un enlace`, detail: $localize`:@@ui.8c3501afc601c2:Crear, revisar y cambiar el destino.` },
    { id: "domains", icon: "language", label: $localize`:@@ui.fd226becda824c:Configurar un dominio`, detail: $localize`:@@ui.69ed2ce7486662:DNS, verificación y conexión HTTPS.` },
    { id: "troubleshooting", icon: "key", label: $localize`:@@ui.f021efd58f9045:Resolver un problema de acceso`, detail: $localize`:@@ui.5c56fea9b551b6:Acceso, hCaptcha y permisos.` },
    { id: "api", icon: "terminal", label: $localize`:@@ui.40dc36d84003e4:Conectar una integración`, detail: $localize`:@@ui.4293fac2828b5b:Tokens de API y eventos de webhook.` },
  ];
  readonly problems = [
    { title: $localize`:@@ui.cf1d3834ce3b1c:La protección antiabuso no se completa`, steps: [$localize`:@@ui.f144f39e2a16af:Deja cargar el formulario. Si el reto ha caducado, complétalo de nuevo.`, $localize`:@@ui.592b4e28158b1d:Comprueba si una extensión o el navegador está bloqueando el proveedor del reto.`, $localize`:@@ui.dbc0835333bbe4:Si aparece un aviso de indisponibilidad, reintenta la carga. No hay un acceso alternativo sin protección.`], next: $localize`:@@ui.839635b174260b:Si persiste, anota la hora y el mensaje exacto, sin incluir contraseñas ni códigos.`, id: "troubleshooting" },
    { title: $localize`:@@ui.7dfd1e0f381e9b:El enlace no abre el destino`, steps: [$localize`:@@ui.90c5d499a3af45:Comprueba el alias y el dominio de la dirección compartida.`, $localize`:@@ui.8747992e6bc106:Revisa estado, caducidad, límites y reglas en el workspace del enlace.`, $localize`:@@ui.7db7a0128e2797:Si usa un dominio propio, revisa también el diagnóstico de DNS y TLS.`], next: $localize`:@@ui.240e213d977f86:No cambies el alias de una dirección que ya has impreso para intentar reparar su destino.`, id: "links" },
    { title: $localize`:@@ui.eb6214630854fe:Faltan enlaces o no puedo editar`, steps: [$localize`:@@ui.6c60fac9efe5a1:Comprueba qué workspace tienes seleccionado.`, $localize`:@@ui.7429acb0ec0901:Revisa tu rol: una persona con acceso de consulta no puede editar.`, $localize`:@@ui.19099f85ec1a5c:Pide a quien administra el espacio que revise tu pertenencia y los permisos.`], next: $localize`:@@ui.c284731ed339e9:No hace falta crear otra cuenta para cambiar de workspace.`, id: "team" },
    { title: $localize`:@@ui.3088a1ed178ce9:Mi integración recibe el mismo evento varias veces`, steps: [$localize`:@@ui.05739fd1f7b767:Compara el event_id de las entregas, no solo el tipo de evento.`, $localize`:@@ui.66cccd52b623af:Comprueba que tu receptor persiste el evento antes de responder con HTTP 2xx.`, $localize`:@@ui.f4b18c69c90d86:Deduplica el efecto por event_id, también cuando solicites un reenvío manual.`], next: $localize`:@@ui.04280012d3e002:La entrega es al menos una vez. Recibir un duplicado no implica un evento nuevo.`, id: "webhooks" },
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
    this.copyMessage.set(success ? $localize`:@@ui.0ebfb16130eaaf:Ejemplo copiado. Sustituye los marcadores de posición en tu entorno privado.` : $localize`:@@ui.872422133b7267:No se pudo copiar. Puedes seleccionar el texto del ejemplo.`);
    if (this.copyTimer !== undefined) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copyMessage.set(""), 5000);
  }

  private normalize(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
}
