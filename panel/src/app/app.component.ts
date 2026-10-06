import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { Endpoint, Mode, Operation, PanelApiService, PanelRejectedError, Status } from './panel-api.service';
type Section = 'overview' | 'logs' | 'maintenance';
type Appearance = 'system' | 'light' | 'dark';
@Component({
  selector: 'app-root', standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatCardModule, MatDialogModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './app.component.html', styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly api = inject(PanelApiService);
  private readonly view = inject(ChangeDetectorRef);
  private readonly dialog = inject(MatDialog);
  protected section: Section = 'overview';
  protected menuOpen = false;
  protected appearance: Appearance = 'system';
  protected connection: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  protected status: Status | null = null;
  // Sin diagnóstico todavía: `status === null` ya bloquea mutaciones y muestra
  // "Comprobando entorno". Marcarlo obsoleto aquí lo presentaría como avería.
  protected stale = false;
  protected refreshing = false;
  protected error = '';
  protected active: Operation | null = null;
  protected history: Operation[] = [];
  protected pending: { mode: Mode; requestId: string } | null = null;
  protected confirming = false;
  protected logSource: 'backend' | 'frontend' = 'backend';
  protected logText = '';
  protected logTime: string | null = null;
  protected logTruncated = false;
  protected logsLoading = false;
  protected logError = '';
  protected follow = false;
  protected search = '';
  private destroyed = false;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private lastStatus = 0;
  private failures = 0;
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly mediaChange = () => this.applyAppearance();
  protected readonly nav: { id: Section; label: string; icon: string; hint: string }[] = [
    { id: 'overview', label: 'Resumen', icon: 'space_dashboard', hint: 'Tu entorno, de un vistazo' },
    { id: 'logs', label: 'Registros', icon: 'terminal', hint: 'Backend y frontend' },
    { id: 'maintenance', label: 'Mantenimiento', icon: 'tune', hint: 'Migraciones y recuperación' },
  ];
  protected readonly labels: Record<Mode, string> = { start: 'Iniciar entorno', stop: 'Detener entorno', restart: 'Reiniciar entorno', migrate: 'Aplicar migraciones', 'repair-docker': 'Reparar Docker' };
  protected get busy(): boolean { return this.confirming || this.pending !== null || this.active !== null; }
  protected get canMutate(): boolean { return !this.busy && !this.revisionRequired && this.connection === 'connected' && !this.stale && this.status !== null; }
  protected get revisionRequired(): boolean { return this.history[0]?.status === 'unknown'; }
  protected get ready(): boolean { return this.status?.endpoints.frontend.status === 'ok' && ['ok', 'slow'].includes(this.status?.endpoints.backend.status ?? ''); }
  protected get running(): number { return this.status?.services.filter((value) => value.status === 'running').length ?? 0; }
  protected get title(): string { return this.nav.find((value) => value.id === this.section)?.label ?? ''; }
  protected get filteredLogs(): string { return this.search.trim() ? this.logText.split('\n').filter((line) => line.toLocaleLowerCase().includes(this.search.toLocaleLowerCase())).join('\n') : this.logText; }
  ngOnInit(): void {
    try { const value = localStorage.getItem('uvh-control-appearance'); if (value === 'light' || value === 'dark' || value === 'system') this.appearance = value; } catch { /* Theme persistence is optional. */ }
    this.applyAppearance(); this.media.addEventListener('change', this.mediaChange);
    void this.refreshStatus(); void this.pollState();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.logTimer) clearTimeout(this.logTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.media.removeEventListener('change', this.mediaChange);
  }
  @HostListener('window:beforeunload', ['$event'])
  protected guardClose(event: BeforeUnloadEvent): void { if (this.busy) { event.preventDefault(); event.returnValue = ''; } }
  @HostListener('document:keydown.escape')
  protected closeMenu(): void { this.menuOpen = false; }
  protected selectSection(section: Section): void {
    this.section = section; this.menuOpen = false;
    if (section !== 'logs' && this.logTimer) { clearTimeout(this.logTimer); this.logTimer = null; }
    if (section === 'logs') void this.refreshLogs();
  }
  protected setAppearance(value: Appearance): void {
    this.appearance = value; this.applyAppearance();
    try { localStorage.setItem('uvh-control-appearance', value); } catch { /* Non-secret preference only. */ }
  }
  private applyAppearance(): void { document.documentElement.classList.toggle('dark', this.appearance === 'dark' || (this.appearance === 'system' && this.media.matches)); }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'No se pudo completar la consulta.'; }
  protected async refreshStatus(): Promise<void> {
    if (this.refreshing || this.destroyed) return;
    this.refreshing = true;
    try {
      const value = await this.api.status(); if (this.destroyed) return;
      this.status = value; this.lastStatus = Date.now(); this.stale = false; this.error = '';
      // Transport status is managed by the single state heartbeat, not competing requests.
    } catch (error) { this.stale = true; this.error = this.message(error); }
    finally {
      this.refreshing = false;
      if (!this.destroyed) this.view.markForCheck();
      if (this.statusTimer) clearTimeout(this.statusTimer);
      // Refrescar no es estar obsoleto: solo un fallo de lectura marca stale.
      if (!this.destroyed) this.statusTimer = setTimeout(() => void this.refreshStatus(), 15000);
    }
  }
  private async pollState(): Promise<void> {
    if (this.polling || this.destroyed) return;
    this.polling = true;
    try {
      const value = await this.api.state(); if (this.destroyed) return;
      const previous = this.active?.id;
      this.connection = 'connected'; this.failures = 0; this.history = value.recentOperations;
      this.active = value.operation;
      if (this.pending) {
        const found = this.history.find((item) => item.requestId === this.pending?.requestId);
        if (found) { this.pending = null; this.error = ''; }
      }
      if (previous && this.active === null) void this.refreshStatus();
      // Una lectura programada o en curso no invalida el diagnóstico; solo un
      // fallo previo lo mantiene obsoleto hasta que una lectura vuelva a ir bien.
      if (this.lastStatus > 0 && Date.now() - this.lastStatus > 20000) void this.refreshStatus();
      if (this.stale) void this.refreshStatus();
    } catch (error) {
      this.failures++; this.connection = 'disconnected'; this.stale = true; this.error = this.message(error);
    } finally {
      this.polling = false;
      if (!this.destroyed) this.view.markForCheck();
      if (!this.destroyed) this.stateTimer = setTimeout(() => void this.pollState(), Math.min(15000, 2000 * 2 ** Math.min(this.failures, 3)));
    }
  }
  protected async runOp(mode: Mode): Promise<void> {
    if (!this.canMutate || !this.status) {
      // Nunca un pulsación silenciosa: si la acción no puede ejecutarse, se dice por qué.
      this.error = this.revisionRequired
        ? 'Hay una operación con resultado desconocido: revisa el historial antes de continuar.'
        : this.connection !== 'connected' ? 'El controlador no responde; no se ejecutó nada. Reintenta cuando vuelva la conexión.'
          : this.stale ? 'El diagnóstico está desactualizado; no se ejecutó nada. Actualiza el estado antes de continuar.'
            : this.pending || this.active || this.confirming ? 'Ya hay una operación en curso; espera a que termine.'
              : 'Todavía no hay un diagnóstico fiable; actualiza el estado antes de continuar.';
      this.view.markForCheck();
      return;
    }
    const sensitive = mode === 'migrate' || mode === 'repair-docker';
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.confirming = true;
    let sending = false;
    try {
      if (sensitive || mode === 'stop' || mode === 'restart') {
        const body = mode === 'migrate' ? 'Se aplicarán las migraciones pendientes. Pueden modificar el esquema y los datos. Conserva un backup si estos datos importan.'
          : mode === 'repair-docker' ? 'Se cerrará Docker Desktop y se archivará su runtime IPC en Windows. Puede afectar a otros proyectos Docker. Requiere una terminal de administrador; el panel no eleva privilegios.'
          : mode === 'restart' ? 'Se detendrán y volverán a iniciar los servicios locales. Si la parada falla, no se iniciará nada de nuevo.'
          : 'Se detendrán los servicios del Compose local y únicamente el frontend registrado por este controlador. Los volúmenes no se eliminan.';
        const accepted = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { width: '520px', maxWidth: 'calc(100vw - 32px)',
          data: { title: this.labels[mode], body, destination: `Base local · ${this.status.migrations.database}`, confirmLabel: this.labels[mode], danger: mode !== 'restart' } }).afterClosed());
        if (accepted !== true) return;
      }
      // Revalidate freshness after a potentially long confirmation dialog.
      if (this.connection !== 'connected' || this.stale || this.active || this.pending) { this.error = 'Actualiza el estado antes de realizar esta operación.'; return; }
      const requestId = crypto.randomUUID();
      this.pending = { mode, requestId }; this.error = '';
      const confirmation = sensitive ? await this.api.confirm(mode, this.status.migrations.database) : undefined;
      sending = true;
      const item = await this.api.start(mode, requestId, confirmation);
      this.pending = null; this.active = item.status === 'running' || item.status === 'unknown' ? item : null;
      this.history = [item, ...this.history.filter((value) => value.id !== item.id)].slice(0, 50);
    } catch (error) {
      if (sending && this.pending && !(error instanceof PanelRejectedError && error.status < 500)) this.error = 'Respuesta no recibida. El resultado es desconocido; no repetiremos la operación. Recuperaremos su estado al reconectar.';
      else { this.pending = null; this.error = this.message(error); }
    } finally {
      this.confirming = false;
      if (!this.destroyed) {
        this.view.detectChanges();
        // The triggering control was disabled during confirmation; Material
        // cannot restore focus until it is enabled again.
        if (!this.busy) trigger?.focus();
      }
    }
  }
  protected async reconcile(): Promise<void> {
    if (this.polling) return;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    await this.pollState();
    if (!this.pending) return;
    // Explicit user retry preserves request id, so lost admission cannot duplicate work.
    const pending = this.pending;
    try {
      const item = await this.api.start(pending.mode, pending.requestId);
      this.pending = null; this.active = item.status === 'running' || item.status === 'unknown' ? item : null;
      this.error = '';
    } catch (error) { this.error = this.message(error); }
    finally { if (!this.destroyed) this.view.markForCheck(); }
  }
  protected showLogs(source: 'backend' | 'frontend'): void { this.logSource = source; this.search = ''; this.selectSection('logs'); }
  protected async refreshLogs(): Promise<void> {
    if (this.logsLoading || this.destroyed) return;
    const source = this.logSource; this.logsLoading = true;
    try {
      const value = await this.api.logs(source);
      if (source !== this.logSource || this.destroyed) return;
      this.logText = value.text; this.logTime = value.checkedAt; this.logTruncated = value.truncated; this.logError = '';
    } catch (error) { this.logError = this.message(error); }
    finally {
      this.logsLoading = false;
      if (!this.destroyed) this.view.markForCheck();
      if (this.logTimer) clearTimeout(this.logTimer);
      if (!this.destroyed && this.follow && this.section === 'logs') this.logTimer = setTimeout(() => void this.refreshLogs(), 2000);
      else if (source !== this.logSource && this.section === 'logs') void this.refreshLogs();
    }
  }
  protected followChanged(): void {
    if (this.logTimer) clearTimeout(this.logTimer);
    if (this.follow) void this.refreshLogs();
  }
  protected openApp(): void { window.open('http://127.0.0.1:4200/', '_blank', 'noopener,noreferrer'); }
  protected endpointLabel(value?: Endpoint): string {
    return value?.status === 'ok' ? 'Disponible' : value?.status === 'slow' ? 'Lento' : value?.status === 'error' ? 'Error HTTP' : value ? 'No disponible' : 'Sin comprobar';
  }
  protected serviceLabel(status: string): string { return status === 'running' ? 'En ejecución' : status === 'stopped' ? 'Detenido' : 'Sin comprobar'; }
  protected serviceName(name: string): string { return ({ postgres: 'PostgreSQL', app: 'Laravel', queue: 'Worker', schedule: 'Scheduler', frontend: 'Angular' } as Record<string, string>)[name] ?? name; }
  protected serviceIcon(name: string): string { return ({ postgres: 'storage', app: 'code', queue: 'layers', schedule: 'schedule', frontend: 'web' } as Record<string, string>)[name] ?? 'dns'; }
  protected operationLabel(status: string): string { return ({ running: 'En curso', succeeded: 'Completada', failed: 'Fallida', timedOut: 'Tiempo agotado', unknown: 'Resultado desconocido' } as Record<string, string>)[status] ?? status; }
}
