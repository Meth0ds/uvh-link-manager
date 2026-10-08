import { signal } from "@angular/core";
import { TestBed, type ComponentFixture, fakeAsync, tick } from "@angular/core/testing";
import { TokensComponent } from "./tokens.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { AuthService } from "../../core/services/auth.service";
import type { ApiTokenDto } from "../../core/models";

const NOW = Date.parse("2026-10-06T12:00:00Z");
function token(expiresAt: string | null, revokedAt: string | null = null): ApiTokenDto {
  return { id: 1, name: "Editorial", scopes: ["links:read"], createdAt: "2026-10-01T10:30:00Z", lastUsedAt: null, expiresAt, revokedAt };
}
describe("Token expiry presentation", () => {
  let fixture: ComponentFixture<TokensComponent>;
  let wallClock: number;
  beforeEach(async () => {
    wallClock = NOW; spyOn(Date, "now").and.callFake(() => wallClock);
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({ tokens: [], truncated: false });
    await TestBed.configureTestingModule({ imports: [TokensComponent], providers: [
      { provide: ApiService, useValue: api },
      { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: signal("owner"), selectionGeneration: () => 0 } },
      { provide: AuthService, useValue: { user: signal({ id: 1, emailVerified: true, mfaEnabled: false }) } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(TokensComponent); fixture.detectChanges(); await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());
  function show(row: ApiTokenDto): HTMLElement {
    fixture.componentInstance.tokens.set([row]); fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  it("renders a past expiry as expired without the active colour", () => {
    const root = show(token("2026-10-06T11:59:59Z"));
    expect(root.querySelector(".state-chip")?.textContent).toContain("Caducado");
    expect(root.querySelector(".state-chip")?.classList.contains("st-active")).toBeFalse();
  });
  it("expires at the exact millisecond boundary", () => {
    expect(fixture.componentInstance.stateLabel(token("2026-10-06T12:00:00Z"))).toBe("Caducado");
  });
  it("updates an open registry at the next expiry without another request", fakeAsync(() => {
    const root = show(token("2026-10-06T12:00:01Z"));
    expect(root.querySelector(".state-chip")?.textContent).toContain("Activo");
    wallClock += 1000; tick(1000); fixture.detectChanges();
    expect(root.querySelector(".state-chip")?.textContent).toContain("Caducado");
    fixture.destroy();
  }));
  it("keeps a token without expiry active", () => {
    expect(fixture.componentInstance.stateLabel(token(null))).toBe("Activo");
  });
  it("gives revocation priority over expiry", () => {
    expect(fixture.componentInstance.stateLabel(token("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"))).toBe("Revocado");
  });
  it("keeps revocation available for an expired token", () => {
    const root = show(token("2026-10-06T11:59:59Z"));
    expect((root.querySelector(".token-actions button") as HTMLButtonElement).disabled).toBeFalse();
    expect(root.querySelector(".token-actions button")?.textContent).toContain("Revocar");
  });
  it("does not round a submillisecond expiry down to the current clock tick", () => {
    expect(fixture.componentInstance.stateLabel(token("2026-10-06T12:00:00.000001Z"))).toBe("Activo");
  });
  it("expires a submillisecond deadline at the next clock tick", () => {
    wallClock += 1;
    expect(fixture.componentInstance.stateLabel(token("2026-10-06T12:00:00.000001Z"))).toBe("Caducado");
  });
  it("compares offset timestamps by their instant", () => {
    expect(fixture.componentInstance.stateLabel(token("2026-10-06T14:00:00+02:00"))).toBe("Caducado");
  });
  it("never shows an invalid expiry as active", () => {
    for (const invalid of ["2026-02-30T12:00:00Z", "2026-10-06T24:00:00Z", "1.5"]) {
      const root = show(token(invalid));
      expect(root.querySelector(".state-chip")?.textContent).toContain("Estado desconocido");
      expect(root.querySelector(".state-chip")?.classList.contains("st-active")).toBeFalse();
    }
  });
  it("refreshes the state after returning to the tab with a changed wall clock", () => {
    const root = show(token("2026-10-06T12:05:00Z"));
    wallClock += 360_000;
    document.dispatchEvent(new Event("visibilitychange")); fixture.detectChanges();
    expect(root.querySelector(".state-chip")?.textContent).toContain("Caducado");
  });
  it("does not overflow a distant deadline into an immediate timer", fakeAsync(() => {
    show(token("2027-10-06T12:00:00Z"));
    const refresh = spyOn(fixture.componentInstance, "refreshClock").and.callThrough();
    tick(1); fixture.detectChanges();
    expect(refresh).not.toHaveBeenCalled();
    fixture.destroy();
  }));
  it("cancels the pending expiry timer when the view is destroyed", fakeAsync(() => {
    show(token("2026-10-06T12:00:01Z"));
    const refresh = spyOn(fixture.componentInstance, "refreshClock").and.callThrough();
    fixture.destroy(); tick(1000);
    expect(refresh).not.toHaveBeenCalled();
  }));
});
