import { DestroyRef, Injectable, effect, inject, signal } from "@angular/core";
import type { LinkDto } from "../models";
import { ApiService } from "./api.service";
import { LinkWorkflowService } from "./link-workflow.service";
import { decodeFavorite } from "./link-workflow-decoders";

interface FavoriteIntent { desired: boolean; confirmed: boolean; running: boolean; context: string }
/** One request per link at a time, while every click updates the last desired state. */
@Injectable({ providedIn: "root" })
export class LinkFavoriteService {
  private readonly api = inject(ApiService);
  private readonly workflows = inject(LinkWorkflowService);
  private readonly owner = inject(DestroyRef);
  private readonly intents = new Map<number, FavoriteIntent>();
  readonly values = signal<ReadonlyMap<number, boolean>>(new Map());
  readonly pending = signal<ReadonlySet<number>>(new Set());
  readonly error = signal<string | null>(null);
  private activeContext = "";
  private currentContext(): string { return JSON.stringify([this.workflows.context(), this.workflows.enabled()]); }
  private synchronizeContext(): void {
    const context = this.currentContext();
    if (context === this.activeContext) return;
    this.activeContext = context;
    this.intents.clear(); this.values.set(new Map()); this.pending.set(new Set()); this.error.set(null);
  }
  constructor() { effect(() => this.synchronizeContext()); }
  value(link: LinkDto): boolean { return (this.activeContext === this.currentContext() ? this.values().get(link.id) : undefined) ?? link.favorite ?? false; }
  toggle(link: LinkDto): void {
    if (!this.workflows.enabled() || this.owner.destroyed) return;
    this.synchronizeContext();
    this.error.set(null);
    const intent = this.intents.get(link.id) ?? { desired: this.value(link), confirmed: this.value(link), running: false, context: this.workflows.context() };
    intent.desired = !intent.desired; this.intents.set(link.id, intent); this.publish(link.id, intent.desired);
    if (!intent.running) void this.flush(link.id, intent);
  }
  private publish(id: number, favorite: boolean): void { this.values.update(values => new Map(values).set(id, favorite)); }
  private async flush(id: number, intent: FavoriteIntent): Promise<void> {
    intent.running = true; this.pending.update(ids => new Set(ids).add(id));
    const current = () => !this.owner.destroyed && this.workflows.enabled() && intent.context === this.workflows.context() && this.intents.get(id) === intent;
    try {
      do {
        const sent = intent.desired;
        const reply = await this.api.patch(`/api/v1/links/${id}/favorite`, { favorite: sent }, decodeFavorite);
        if (!current()) return;
        if (reply.favorite !== sent) throw new Error("La respuesta del favorito no coincide.");
        intent.confirmed = reply.favorite;
      } while (intent.desired !== intent.confirmed);
    } catch {
      if (current()) { intent.desired = intent.confirmed; this.publish(id, intent.confirmed); this.error.set("No se pudo guardar el favorito. Vuelve a intentarlo."); }
    } finally {
      if (current()) { intent.running = false; this.pending.update(ids => { const next = new Set(ids); next.delete(id); return next; }); }
    }
  }
}
