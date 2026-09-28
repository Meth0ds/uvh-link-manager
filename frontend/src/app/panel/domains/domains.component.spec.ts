import { signal } from "@angular/core";
import { flushMicrotasks, fakeAsync, TestBed, tick, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { DomainsComponent } from "./domains.component";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { DomainDto } from "../../core/models";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function domainDto(overrides: Partial<DomainDto> = {}): DomainDto {
  return {
    id: 7,
    domain: "go.example.test",
    state: "verified",
    desiredState: "enabled",
    ownershipStatus: "verified",
    routingStatus: "healthy",
    tlsStatus: "pending",
    trafficStatus: "offline",
    servingReady: false,
    verificationHost: "_uvh-verification.go.example.test",
    verificationToken: "opaque-token",
    cnameTarget: "edge.example.test",
    verificationScheme: 2,
    verifiedAt: "2026-09-28T10:00:00Z",
    ownershipVerifiedAt: "2026-09-28T10:00:00Z",
    routingVerifiedAt: "2026-09-28T10:00:00Z",
    dnsCheckStartedAt: "2026-09-28T10:00:00Z",
    dnsCheckCompletedAt: "2026-09-28T10:00:05Z",
    dnsError: null,
    dnsCheckInProgress: false,
    automaticDnsRetry: true,
    dnsRetryIntervalHours: 24,
    nextDnsCheckAt: "2026-09-29T10:00:00Z",
    dnsCheckDue: false,
    dnsFailureCount: 0,
    dnsMaxFailures: 3,
    dnsFirstFailedAt: null,
    graceExpiresAt: null,
    dnsObservedAt: null,
    ownershipTxtPresent: null,
    routingObservedTarget: null,
    routingObservedTtl: null,
    routingObservedAddresses: null,
    routingObservedProxied: null,
    caaRecords: null,
    caaAllowsIssuer: null,
    acmeIssuer: "letsencrypt.org",
    edgeEligible: false,
    tlsReadyAt: null,
    tlsError: null,
    tlsCheckedAt: null,
    tlsNotAfter: null,
    tlsIssuer: null,
    tlsDaysRemaining: null,
    tlsLastAttemptAt: null,
    tlsNextRetryAt: null,
    tlsProbeFailures: 0,
    rootDestination: null,
    notFoundMode: null,
    isDefault: false,
    createdAt: "2026-09-28T09:00:00Z",
    ...overrides,
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

describe("DomainsComponent create ownership", () => {
  let fixture: ComponentFixture<DomainsComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const role = signal("owner");
  const workspace = signal(1);

  beforeEach(async () => {
    role.set("owner");
    workspace.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({ domains: [] });
    await TestBed.configureTestingModule({
      imports: [DomainsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DomainsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  /**
   * The ABA the row-scoped actions already escaped, on the create flow:
   * create 1 in flight, the context leaves and returns (which frees the slot
   * its `finally` will never free), create 2 starts on the same workspace —
   * and create 1 lands late, when `target.isCurrent()` is TRUE again. Only the
   * operation identity can tell that its result is not create 2's to publish:
   * without it, the stale create inserts its row, shows its snackbar and clears
   * the busy flag while create 2 is still in flight.
   */
  it("a late create never publishes over a newer one nor steals its busy slot", async () => {
    const component = fixture.componentInstance;
    const first = deferred<{ domain: Partial<DomainDto> }>();
    const second = deferred<{ domain: Partial<DomainDto> }>();
    api.post.and.returnValues(first.promise as never, second.promise as never);

    // Create 1 starts on workspace 1…
    component.newDomain.set("primero.example");
    const add1 = component.add();
    expect(component.adding()).toBeTrue();

    // …the context leaves and comes back: the stale create's slot is dead.
    workspace.set(2);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    workspace.set(1);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();

    // Create 2 starts on the same workspace create 1 named.
    component.newDomain.set("segundo.example");
    const add2 = component.add();
    expect(component.adding()).toBeTrue();

    // Create 1 lands late. It must publish nothing at all.
    first.resolve({ domain: { id: 1, domain: "primero.example" } });
    await add1;
    expect(component.adding()).toBeTrue();
    expect(component.domains().map((d) => d.domain)).not.toContain("primero.example");

    // Create 2 settles its own slot and publishes its own result.
    second.resolve({ domain: { id: 2, domain: "segundo.example" } });
    await add2;
    expect(component.adding()).toBeFalse();
    expect(component.domains().map((d) => d.domain)).toContain("segundo.example");
    expect(component.domains().map((d) => d.domain)).not.toContain("primero.example");
  });
});

describe("DomainsComponent permission guards and resilient follow-up", () => {
  let fixture: ComponentFixture<DomainsComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const role = signal("owner");
  const workspace = signal(1);

  beforeEach(async () => {
    role.set("owner");
    workspace.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    api.get.and.resolveTo({ domains: [] });
    api.post.and.resolveTo({ state: "verifying" } as never);
    api.patch.and.resolveTo(undefined as never);
    await TestBed.configureTestingModule({
      imports: [DomainsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DomainsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("admin-only actions never leave the client for an editor", async () => {
    role.set("editor");
    const component = fixture.componentInstance;
    await component.disable(domainDto());
    expect(api.post).not.toHaveBeenCalled();
    // …but the editor-scoped preference is theirs to make.
    await component.setDefault(domainDto({ servingReady: true }), true);
    expect(api.patch).toHaveBeenCalledWith("/api/v1/domains/7", { isDefault: true });
  });

  it("a viewer starts no mutation at all", async () => {
    role.set("viewer");
    const component = fixture.componentInstance;
    await component.verify(domainDto());
    await component.activate(domainDto({ state: "verified" }));
    await component.setDefault(domainDto({ servingReady: true }), true);
    await component.disable(domainDto());
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("the activation race guard mirrors the server while a DNS check is in flight", async () => {
    const component = fixture.componentInstance;
    await component.activate(domainDto({ state: "verified", dnsCheckInProgress: true }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("a transient read failure keeps the follow-up alive until DNS hands over to TLS", fakeAsync(() => {
    const component = fixture.componentInstance;
    api.get.calls.reset();
    // Intento 1: la red falla (no cuenta como asentado). Intento 2: el DNS ya
    // confirmó pero el TLS sigue emitiendo —la cadena no ha terminado—. Intento
    // 3: listo. Sólo entonces la sonda se detiene.
    let call = 0;
    api.get.and.callFake(() => {
      call += 1;
      if (call === 1) return Promise.reject(new Error("network")) as never;
      return Promise.resolve({
        domains: [domainDto({ id: 7, dnsCheckInProgress: false, tlsStatus: call === 2 ? "provisioning" : "ready" })],
      }) as never;
    });

    void component.verify(domainDto({ id: 7, state: "verifying" }));
    flushMicrotasks(); // La verificación arranca y programa la primera espera.
    tick(2_000);
    flushMicrotasks(); // Intento 1: fallo transitorio → backoff, no abandono.
    tick(2_000);
    flushMicrotasks(); // Intento 2: TLS en curso → la cadena sigue.
    tick(4_000);
    flushMicrotasks(); // Intento 3: asentado.
    tick(60_000);

    expect(api.get).toHaveBeenCalledTimes(3);
    expect(component.domains()[0]?.tlsStatus).toBe("ready");
  }));
});

describe("DomainsComponent idempotent mutations", () => {
  let fixture: ComponentFixture<DomainsComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const role = signal("owner");
  const workspace = signal(1);

  beforeEach(async () => {
    role.set("owner");
    workspace.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({ domains: [] });
    await TestBed.configureTestingModule({
      imports: [DomainsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: role } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DomainsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  function keyFor(callIndex: number): string {
    const headers = api.post.calls.argsFor(callIndex)[3] as Record<string, string>;
    return headers["Idempotency-Key"];
  }

  it("keeps the create key across an ambiguous failure and rotates it after a definitive answer", async () => {
    const component = fixture.componentInstance;
    component.newDomain.set("new.example.test");

    // Sin respuesta del servidor: el reintento debe ser la MISMA intención.
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.add();
    const first = keyFor(0);
    expect(first).toBeTruthy();
    await component.add();
    expect(keyFor(1)).toBe(first);

    // El servidor negó de forma definitiva: esa petición aún llevaba la clave
    // de la intención, pero la intención queda cerrada y el siguiente clic es
    // una intención nueva.
    api.post.and.rejectWith(new ApiRequestError("El dominio no es válido", 422));
    await component.add();
    expect(keyFor(2)).toBe(first);
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.add();
    expect(keyFor(3)).not.toBe(first);
  });

  it("keeps the activation key across ambiguous failures and relays", async () => {
    const component = fixture.componentInstance;
    const d = domainDto({ id: 7, state: "verified", dnsCheckInProgress: false });

    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.activate(d);
    const first = keyFor(0);
    expect(first).toBeTruthy();

    // El 409 de relevo pide repetir la MISMA petición: la clave no puede rotar.
    api.post.and.rejectWith(new ApiRequestError("Ya hay una operación en curso con esta clave. Espera a que termine.", 409));
    await component.activate(d);
    expect(keyFor(1)).toBe(first);

    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.activate(d);
    expect(keyFor(2)).toBe(first);
  });
});
