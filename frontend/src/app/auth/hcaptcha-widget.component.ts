import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnDestroy,
  Output,
  EventEmitter,
  ViewChild,
  effect,
  inject,
  signal,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { ThemeService } from "../core/services/theme.service";

type HumanCheckState = "loading" | "ready" | "verified" | "expired" | "error";

interface HCaptchaFrameMessage {
  source?: unknown;
  channel?: unknown;
  type?: unknown;
  token?: unknown;
}

@Component({
  selector: "app-hcaptcha-widget",
  standalone: true,
  imports: [MatIconModule],
  template: `
    <section class="human-check" [attr.aria-busy]="state() === 'loading'">
      <div class="widget-stage" [class.compact]="compact()" [class.challenge-open]="challengeOpen()">
        <iframe
          #captchaFrame
          src="/hcaptcha-frame.html"
          title="Comprobación de hCaptcha"
          sandbox="allow-scripts allow-forms allow-popups"
          referrerpolicy="no-referrer"
          loading="eager"
          (load)="onFrameLoad()"
        ></iframe>
      </div>

      @if (state() === 'error' || state() === 'expired') {
        <div class="check-foot">
          <span>{{ state() === 'expired' ? 'La comprobación ha caducado.' : 'No se pudo completar la comprobación.' }}</span>
          <button type="button" (click)="retry()"><mat-icon aria-hidden="true">refresh</mat-icon> Reintentar</button>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .human-check { min-width: 0; }
    .widget-stage { display: grid; min-height: 82px; place-items: center; overflow: visible; }
    iframe { display: block; width: 304px; height: 78px; border: 0; color-scheme: light dark; }
    .widget-stage.compact { min-height: 148px; }
    .widget-stage.compact iframe { width: 164px; height: 144px; }
    .widget-stage.challenge-open iframe { position: fixed; z-index: 5000; inset: 0; width: 100vw; height: 100dvh; background: transparent; }
    .check-foot, .check-foot button { display: flex; align-items: center; }
    .check-foot { justify-content: center; gap: 8px; margin-top: 6px; color: var(--uvh-muted); font-size: 10.5px; line-height: 1.35; }
    .check-foot button { gap: 5px; }
    .check-foot mat-icon { width: 14px; height: 14px; font-size: 14px; }
    .check-foot button { padding: 3px 5px; border: 0; border-radius: 7px; background: transparent; color: var(--uvh-electric); font: inherit; font-weight: 800; cursor: pointer; }
    .check-foot button:hover { background: color-mix(in srgb, var(--uvh-electric) 9%, transparent); }
    .check-foot button:focus-visible { outline: 2px solid var(--uvh-electric); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .check-foot button { transition: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HCaptchaWidgetComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) siteKey = "";
  @Output() readonly tokenChange = new EventEmitter<string>();
  @ViewChild("captchaFrame", { static: true }) private frame!: ElementRef<HTMLIFrameElement>;
  @HostBinding("class.challenge-open") get hostChallengeOpen(): boolean { return this.challengeOpen(); }

  private readonly theme = inject(ThemeService);
  private readonly channel = this.createChannel();
  private frameLoaded = false;
  private activeTheme: "light" | "dark" | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = signal<HumanCheckState>("loading");
  readonly challengeOpen = signal(false);
  readonly compact = signal(typeof window !== "undefined" && window.matchMedia("(max-width: 380px)").matches);
  readonly stateLabel = () => ({ loading: "Cargando", ready: "Pendiente", verified: "Verificado", expired: "Caducado", error: "Reintentar" })[this.state()];
  readonly stateCopy = () => ({
    loading: "Cargando…",
    ready: "Completa el control para continuar.",
    verified: "Completado.",
    expired: "Ha caducado; complétalo de nuevo.",
    error: "No se pudo cargar. Reinténtalo.",
  })[this.state()];

  constructor() {
    effect(() => {
      const resolved = this.theme.resolved();
      if (this.activeTheme !== null && this.activeTheme !== resolved && this.frameLoaded) {
        this.reloadFrame();
      }
      this.activeTheme = resolved;
    });
  }

  ngAfterViewInit(): void {
    window.addEventListener("message", this.onMessage);
    window.addEventListener("resize", this.onResize, { passive: true });
    this.armLoadTimeout();
  }

  ngOnDestroy(): void {
    window.removeEventListener("message", this.onMessage);
    window.removeEventListener("resize", this.onResize);
    if (this.loadTimer) clearTimeout(this.loadTimer);
  }

  onFrameLoad(): void {
    this.frameLoaded = true;
    this.state.set("loading");
    this.challengeOpen.set(false);
    this.sendInit();
    this.armLoadTimeout();
  }

  reset(): void {
    this.tokenChange.emit("");
    this.state.set("loading");
    this.challengeOpen.set(false);
    this.post({ type: "reset" });
    this.armLoadTimeout();
  }

  retry(): void {
    this.reloadFrame();
  }

  private readonly onMessage = (event: MessageEvent<HCaptchaFrameMessage>): void => {
    if (event.source !== this.frame.nativeElement.contentWindow || !event.data || event.data.source !== "uvh-hcaptcha-frame") return;
    if (event.data.type === "frame-ready") {
      this.sendInit();
      return;
    }
    if (event.data.channel !== this.channel) return;

    switch (event.data.type) {
      case "ready":
        this.state.set("ready");
        this.clearLoadTimeout();
        break;
      case "verified": {
        const token = typeof event.data.token === "string" ? event.data.token : "";
        if (!token || token.length > 8192) {
          this.fail();
          return;
        }
        this.state.set("verified");
        this.challengeOpen.set(false);
        this.tokenChange.emit(token);
        this.clearLoadTimeout();
        break;
      }
      case "expired":
        this.state.set("expired");
        this.challengeOpen.set(false);
        this.tokenChange.emit("");
        break;
      case "challenge-open":
        this.challengeOpen.set(true);
        break;
      case "challenge-close":
        this.challengeOpen.set(false);
        break;
      case "error":
        this.fail();
        break;
    }
  };

  private readonly onResize = (): void => {
    const next = window.matchMedia("(max-width: 380px)").matches;
    if (next === this.compact()) return;
    this.compact.set(next);
    this.reloadFrame();
  };

  private sendInit(): void {
    if (!this.siteKey || !/^[A-Za-z0-9_-]{20,200}$/.test(this.siteKey)) {
      this.fail();
      return;
    }
    this.post({
      type: "init",
      siteKey: this.siteKey,
      theme: this.theme.resolved(),
      size: this.compact() ? "compact" : "normal",
    });
  }

  private post(message: Record<string, unknown>): void {
    this.frame.nativeElement.contentWindow?.postMessage({
      source: "uvh-hcaptcha-host",
      channel: this.channel,
      ...message,
    }, "*");
  }

  private reloadFrame(): void {
    this.tokenChange.emit("");
    this.state.set("loading");
    this.challengeOpen.set(false);
    this.frameLoaded = false;
    this.frame.nativeElement.src = `/hcaptcha-frame.html?reload=${Date.now()}`;
    this.armLoadTimeout();
  }

  private fail(): void {
    this.state.set("error");
    this.challengeOpen.set(false);
    this.tokenChange.emit("");
    this.clearLoadTimeout();
  }

  private armLoadTimeout(): void {
    this.clearLoadTimeout();
    this.loadTimer = setTimeout(() => {
      if (this.state() === "loading") this.fail();
    }, 12_000);
  }

  private clearLoadTimeout(): void {
    if (!this.loadTimer) return;
    clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private createChannel(): string {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}
