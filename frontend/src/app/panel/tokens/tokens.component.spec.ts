import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { TokensComponent } from "./tokens.component";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";

describe("TokensComponent presentation safety", () => {
  let fixture: ComponentFixture<TokensComponent>;
  let api: jasmine.SpyObj<ApiService>;
  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({ tokens: [] });
    await TestBed.configureTestingModule({ imports: [TokensComponent], providers: [
      provideRouter([]), { provide: ApiService, useValue: api },
      { provide: WorkspaceService, useValue: { currentId: signal(1) } },
      { provide: AuthService, useValue: { user: signal({ mfaEnabled: true }) } },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(false) } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(TokensComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("keeps issuance unavailable until all existing identity requirements are satisfied", () => {
    const button = fixture.nativeElement.querySelector(".issue-actions button") as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain("Segundo factor");
    expect(fixture.nativeElement.querySelectorAll(".scopes input[type=checkbox]").length).toBe(5);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("announces secret availability without putting the credential in a live region", () => {
    // Pure presentation state: not a server-issued credential or login.
    fixture.componentInstance.plainToken.set("fictional-not-a-credential");
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".plain-box code").textContent).toContain("fictional-not-a-credential");
    const announcements = Array.from(fixture.nativeElement.querySelectorAll('[role="status"], [aria-live]') as NodeListOf<HTMLElement>);
    expect(announcements.some((node) => node.textContent?.includes("Token generado"))).toBeTrue();
    expect(announcements.some((node) => node.textContent?.includes("fictional-not-a-credential"))).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows busy feedback and prevents another issuance click", () => {
    fixture.componentInstance.creating.set(true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(".issue-actions button") as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(button.textContent).toContain("Generando token");
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("labels registry actions with their token and retains the revoked disabled state", () => {
    fixture.componentInstance.tokens.set([{ id: 1, name: "Editorial", scopes: ["links:read"],
      createdAt: "2026-09-13", lastUsedAt: null, expiresAt: null, revokedAt: "2026-09-13" }]);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(".token-actions button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Token revocado: Editorial");
    expect(button.disabled).toBeTrue();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
