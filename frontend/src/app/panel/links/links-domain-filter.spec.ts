import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { of } from "rxjs";
import { LinksComponent } from "./links.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { DomainDto, LinkDto } from "../../core/models";

const link = {
  id: 1, alias: "example-1", shortUrl: "https://uvh.test/example-1",
  destination: "https://example.test/article", tags: [], state: "active", clickCount: 3,
} as unknown as LinkDto;

function domainDto(id: number): DomainDto {
  return {
    id, domain: `go${id}.example.test`, state: "active", desiredState: "enabled",
    ownershipStatus: "verified", routingStatus: "healthy", tlsStatus: "ready",
    trafficStatus: "online", servingReady: true,
    verificationHost: `_uvh-verification.go${id}.example.test`, verificationToken: null,
    cnameTarget: "edge.example.test", verificationScheme: 2,
    verifiedAt: "2026-09-28T10:00:00Z", ownershipVerifiedAt: "2026-09-28T10:00:00Z",
    routingVerifiedAt: "2026-09-28T10:00:00Z", dnsCheckStartedAt: null, dnsCheckCompletedAt: null,
    dnsError: null, dnsCheckInProgress: false, automaticDnsRetry: true, dnsRetryIntervalHours: 24,
    nextDnsCheckAt: "2026-09-29T10:00:00Z", dnsCheckDue: false, dnsFailureCount: 0, dnsMaxFailures: 3,
    dnsFirstFailedAt: null, graceExpiresAt: null, dnsObservedAt: null, ownershipTxtPresent: null,
    routingObservedTarget: null, routingObservedTtl: null, routingObservedAddresses: null,
    routingObservedProxied: null, caaRecords: null, caaAllowsIssuer: null, acmeIssuer: "letsencrypt.org",
    edgeEligible: true, tlsReadyAt: "2026-09-28T10:05:00Z", tlsError: null, tlsCheckedAt: null,
    tlsNotAfter: null, tlsIssuer: null, tlsDaysRemaining: null, tlsLastAttemptAt: null,
    tlsNextRetryAt: null, tlsProbeFailures: 0, rootDestination: null, notFoundMode: null,
    isDefault: false, linksCount: 0, createdAt: "2026-09-28T09:00:00Z",
  };
}

describe("LinksComponent one-shot domain filter from the URL", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const workspace = signal(1);

  async function mount(query: Record<string, string>): Promise<void> {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.callFake(((path: string) => Promise.resolve(
      path === "/api/v1/domains"
        ? { domains: [domainDto(7), domainDto(8)] }
        : { links: [link], total: 1, page: 1, perPage: 20 },
    )) as never);
    await TestBed.configureTestingModule({
      imports: [LinksComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(query) },
            queryParamMap: of(convertToParamMap(query)),
          },
        },
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: signal("owner") } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LinksComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it("filters by the domain the URL names and keeps it across reloads", async () => {
    await mount({ domainId: "7" });
    const component = fixture.componentInstance;
    expect(component.domainId()).toBe(7);
    const linkCalls = api.get.calls.all().filter((c) => c.args[0] === "/api/v1/links");
    expect(linkCalls[linkCalls.length - 1].args[1]).toEqual(jasmine.objectContaining({ domainId: 7 }));
    await component.reload();
    const after = api.get.calls.all().filter((c) => c.args[0] === "/api/v1/links");
    expect(after[after.length - 1].args[1]).toEqual(jasmine.objectContaining({ domainId: 7 }));
  });

  it("consumes the entry once: a workspace change cannot filter by a foreign domain", async () => {
    await mount({ domainId: "7" });
    const component = fixture.componentInstance;
    expect(component.domainId()).toBe(7);
    workspace.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.domainId()).toBeNull();
    workspace.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The URL param is spent: coming back to the workspace does not reapply it.
    expect(component.domainId()).toBeNull();
  });

  it("refuses a malformed domainId instead of requesting a row by guesswork", async () => {
    await mount({ domainId: "1e3" });
    const component = fixture.componentInstance;
    expect(component.domainId()).toBeNull();
    const linkCalls = api.get.calls.all().filter((c) => c.args[0] === "/api/v1/links");
    expect(linkCalls[linkCalls.length - 1].args[1]).toEqual(jasmine.objectContaining({ domainId: "" }));
  });
});
