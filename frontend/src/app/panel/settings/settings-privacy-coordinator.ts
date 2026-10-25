import { afterNextRender } from "@angular/core";
import { type PageEvent } from "@angular/material/paginator";
import type { PrivacyRightRequest } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { decodePrivacyRequestCreated, decodePrivacyRequestsPage } from "../../core/services/privacy-response-decoders";
import { decodePublicActionAcknowledgement } from "../../core/services/public-action-response-decoders";
import type { SettingsComponent } from "./settings.component";

interface SettingsPrivacyCoordinatorContext {
  readonly accountContext: SettingsComponent["accountContext"];
  readonly actions: SettingsComponent["actions"];
  readonly activeSection: SettingsComponent["activeSection"];
  readonly api: SettingsComponent["api"];
  readonly auth: SettingsComponent["auth"];
  readonly destroyRef: SettingsComponent["destroyRef"];
  readonly injector: SettingsComponent["injector"];
  readonly privacyAction: SettingsComponent["privacyAction"];
  readonly privacyBusy: SettingsComponent["privacyBusy"];
  readonly privacyError: SettingsComponent["privacyError"];
  readonly privacyForm: SettingsComponent["privacyForm"];
  readonly privacyLoading: SettingsComponent["privacyLoading"];
  readonly privacyMutationError: SettingsComponent["privacyMutationError"];
  readonly privacyMutationRequest: SettingsComponent["privacyMutationRequest"];
  readonly privacyPage: SettingsComponent["privacyPage"];
  readonly privacyPageSize: SettingsComponent["privacyPageSize"];
  readonly privacyReceipt: SettingsComponent["privacyReceipt"];
  readonly privacyReceiptBlock: SettingsComponent["privacyReceiptBlock"];
  readonly privacyRequest: SettingsComponent["privacyRequest"];
  readonly privacyRequests: SettingsComponent["privacyRequests"];
  privacyResponseContext: SettingsComponent["privacyResponseContext"];
  readonly privacyResponseDrafts: SettingsComponent["privacyResponseDrafts"];
  readonly privacyResponseForm: SettingsComponent["privacyResponseForm"];
  readonly privacyResponseId: SettingsComponent["privacyResponseId"];
  readonly privacyResponseInput: SettingsComponent["privacyResponseInput"];
  readonly privacyTotal: SettingsComponent["privacyTotal"];
  readonly snackbar: SettingsComponent["snackbar"];
  readonly toast: SettingsComponent["toast"];
  readonly user: SettingsComponent["user"];
}

/** Behaviour coordinator; forms and signals remain owned by the mounted view. */
export class SettingsPrivacyCoordinator {
  constructor(private readonly context: SettingsPrivacyCoordinatorContext) {}

  async loadPrivacyRequests(notify = false): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    const page = this.context.privacyPage() + 1;
    const perPage = this.context.privacyPageSize();
    const context = `${this.context.auth.sessionGeneration()}:${this.context.privacyPage()}:${perPage}`;
    const request = this.context.privacyRequest.begin(context);
    this.context.privacyLoading.set(true);
    this.context.privacyError.set(null);
    try {
      const response = await this.context.api.get<{ requests: PrivacyRightRequest[]; total: number }>("/api/v1/auth/privacy-requests", {
        page,
        perPage,
      }, (value) => decodePrivacyRequestsPage(value, { page, perPage }), { signal: request.signal });
      const current = `${this.context.auth.sessionGeneration()}:${this.context.privacyPage()}:${this.context.privacyPageSize()}`;
      if (!this.context.privacyRequest.isCurrent(request, current)) return;
      this.context.privacyRequests.set(response.requests);
      this.context.privacyTotal.set(response.total);
    } catch (error) {
      const current = `${this.context.auth.sessionGeneration()}:${this.context.privacyPage()}:${this.context.privacyPageSize()}`;
      if (!this.context.privacyRequest.isCurrent(request, current)) return;
      this.context.privacyRequests.set([]);
      this.context.privacyError.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.cfaf0e382ffa5a:No se pudieron cargar las solicitudes`);
      if (notify) this.context.toast(error, $localize`:@@ui.cfaf0e382ffa5a:No se pudieron cargar las solicitudes`);
    } finally {
      const current = `${this.context.auth.sessionGeneration()}:${this.context.privacyPage()}:${this.context.privacyPageSize()}`;
      if (this.context.privacyRequest.isCurrent(request, current)) this.context.privacyLoading.set(false);
    }
  }

  onPrivacyPage(event: PageEvent): void {
    this.context.privacyPage.set(event.pageIndex);
    this.context.privacyPageSize.set(event.pageSize);
    void this.loadPrivacyRequests();
  }

  async submitPrivacyRequest(): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    const type = this.context.privacyForm.controls.type.value;
    const detailControl = this.context.privacyForm.controls.details;
    const details = detailControl.value.trim();
    if (detailControl.hasError("detailRequired")) {
      const remaining = { ...(detailControl.errors ?? {}) };
      delete remaining["detailRequired"];
      detailControl.setErrors(Object.keys(remaining).length ? remaining : null);
    }
    if (["rectification", "objection", "restriction"].includes(type) && details.length < 10) {
      detailControl.setErrors({ ...(detailControl.errors ?? {}), detailRequired: true });
    }
    if (this.context.privacyForm.invalid || this.context.privacyBusy()) {
      this.context.privacyForm.markAllAsTouched();
      return;
    }
    const request = this.context.privacyMutationRequest.begin(this.context.accountContext());
    const current = () => this.context.privacyMutationRequest.isCurrent(request, this.context.accountContext());
    this.startPrivacyMutation("create");
    try {
      const response = await this.context.api.post<unknown>("/api/v1/auth/privacy-requests", { type, details });
      if (!current()) return;
      let admitted: PrivacyRightRequest;
      try { admitted = decodePrivacyRequestCreated(response, type); }
      catch { throw new ApiRequestError($localize`:@@ui.9014251881a1ec:No pudimos confirmar el registro. Conservamos el texto; comprueba el seguimiento antes de volver a enviarlo.`, 502); }
      this.context.privacyReceipt.set({ id: admitted.id, type: admitted.type, dueAt: admitted.dueAt });
      afterNextRender(() => {
        if (current() && this.context.activeSection() === "privacy" && this.context.privacyReceipt()?.id === admitted.id) {
          const receipt = this.context.privacyReceiptBlock()?.nativeElement;
          receipt?.focus({ preventScroll: true });
          receipt?.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      }, { injector: this.context.injector });
      this.context.privacyForm.reset({ type: "access", details: "" });
      this.context.privacyPage.set(0);
      await this.loadPrivacyRequests(false);
      if (!current()) return;
      this.context.snackbar.open($localize`:@@ui.7741b3a10a9b4d:Solicitud registrada y plazo iniciado`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3500 });
    } catch (error) {
      if (!current()) return;
      this.context.privacyMutationError.set(this.privacyFailure(error));
      await this.loadPrivacyRequests(false);
    } finally {
      if (current()) this.finishPrivacyMutation();
    }
  }

  beginPrivacyResponse(id: number): void {
    if (!this.context.user() || this.context.destroyRef.destroyed || this.context.privacyBusy()) return;
    const context = this.context.accountContext();
    if (this.context.privacyResponseId() === id && this.context.privacyResponseContext === context) return;
    this.rememberPrivacyResponse();
    this.context.privacyResponseId.set(id);
    this.context.privacyResponseContext = context;
    this.context.privacyResponseForm.reset({ message: this.context.privacyResponseDrafts.get(`${context}:${id}`) ?? "" });
    afterNextRender(() => {
      if (!this.context.destroyRef.destroyed && context === this.context.accountContext() && this.context.privacyResponseId() === id
        && this.context.activeSection() === "privacy") this.context.privacyResponseInput()?.nativeElement.focus({ preventScroll: true });
    }, { injector: this.context.injector });
  }

  async respondPrivacy(request: PrivacyRightRequest): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    if (this.context.privacyResponseForm.invalid || this.context.privacyBusy()) {
      this.context.privacyResponseForm.markAllAsTouched();
      return;
    }
    const mutation = this.context.privacyMutationRequest.begin(this.context.accountContext());
    const current = () => this.context.privacyMutationRequest.isCurrent(mutation, this.context.accountContext());
    this.startPrivacyMutation("respond");
    try {
      const response = await this.context.api.post<unknown>(`/api/v1/auth/privacy-requests/${request.id}/respond`, {
        message: this.context.privacyResponseForm.controls.message.value.trim(),
      });
      if (!current()) return;
      this.confirmPrivacyAcknowledgement(response);
      this.context.privacyResponseDrafts.delete(`${this.context.accountContext()}:${request.id}`);
      this.context.privacyResponseId.set(null);
      this.context.privacyResponseContext = null;
      this.context.privacyResponseForm.reset();
      await this.loadPrivacyRequests(false);
      if (!current()) return;
      this.context.snackbar.open($localize`:@@ui.5e1fff735fdae3:Respuesta incorporada al expediente`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 3000 });
    } catch (error) {
      if (!current()) return;
      this.context.privacyMutationError.set(this.privacyFailure(error));
      await this.loadPrivacyRequests(false);
    } finally {
      if (current()) this.finishPrivacyMutation();
    }
  }

  async cancelPrivacy(request: PrivacyRightRequest): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed || this.context.privacyBusy()) return;
    const mutation = this.context.privacyMutationRequest.begin(this.context.accountContext());
    const current = () => this.context.privacyMutationRequest.isCurrent(mutation, this.context.accountContext());
    const confirmed = await this.context.actions.confirm({
      title: $localize`:@@ui.c9d98050b715ed:Cancelar solicitud`,
      message: $localize`:@@ui.dbdcf79b5764a9:El expediente quedará cerrado como cancelado. Podrás crear otra solicitud del mismo tipo más adelante.`,
      confirmLabel: $localize`:@@ui.c9d98050b715ed:Cancelar solicitud`,
      destructive: true,
    });
    if (!confirmed || !current() || this.context.privacyBusy()) return;
    this.startPrivacyMutation("cancel");
    try {
      const response = await this.context.api.post<unknown>(`/api/v1/auth/privacy-requests/${request.id}/cancel`, {});
      if (!current()) return;
      this.confirmPrivacyAcknowledgement(response);
      await this.loadPrivacyRequests();
      if (!current()) return;
      this.context.snackbar.open($localize`:@@ui.e075f56997a31c:Solicitud cancelada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
    } catch (error) {
      if (!current()) return;
      this.context.privacyMutationError.set(this.privacyFailure(error));
      await this.loadPrivacyRequests(false);
    } finally {
      if (current()) this.finishPrivacyMutation();
    }
  }

  closePrivacyResponse(): void {
    if (this.context.privacyBusy() || this.context.destroyRef.destroyed) return;
    this.rememberPrivacyResponse();
    this.context.privacyResponseId.set(null);
    this.context.privacyResponseContext = null;
  }

  rememberPrivacyResponse(): void {
    const id = this.context.privacyResponseId(), context = this.context.privacyResponseContext;
    if (id === null || context !== this.context.accountContext()) return;
    const key = `${context}:${id}`;
    this.context.privacyResponseDrafts.delete(key);
    if (this.context.privacyResponseDrafts.size >= 20) {
      const oldest = this.context.privacyResponseDrafts.keys().next().value;
      if (oldest !== undefined) this.context.privacyResponseDrafts.delete(oldest);
    }
    this.context.privacyResponseDrafts.set(key, this.context.privacyResponseForm.controls.message.value);
  }

  startPrivacyMutation(action: "create" | "respond" | "cancel"): void {
    this.context.privacyBusy.set(true);
    this.context.privacyAction.set(action);
    this.context.privacyMutationError.set(null);
    this.context.privacyReceipt.set(null);
    this.context.privacyForm.disable({ emitEvent: false });
    this.context.privacyResponseForm.disable({ emitEvent: false });
  }

  finishPrivacyMutation(): void {
    this.context.privacyBusy.set(false);
    this.context.privacyAction.set(null);
    this.context.privacyForm.enable({ emitEvent: false });
    this.context.privacyResponseForm.enable({ emitEvent: false });
  }

  confirmPrivacyAcknowledgement(response: unknown): void {
    try { decodePublicActionAcknowledgement(response); }
    catch { throw new ApiRequestError($localize`:@@ui.8caf71d50f77ff:No pudimos confirmar el cambio. Conservamos tu texto; comprueba el seguimiento antes de repetir la acción.`, 502); }
  }

  privacyFailure(error: unknown): string {
    return error instanceof ApiRequestError ? error.message
      : $localize`:@@ui.8caf71d50f77ff:No pudimos confirmar el cambio. Conservamos tu texto; comprueba el seguimiento antes de repetir la acción.`;
  }
}
