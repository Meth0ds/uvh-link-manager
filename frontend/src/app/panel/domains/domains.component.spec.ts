import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { DomainsComponent } from "./domains.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { DomainDto } from "../../core/models";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
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
