import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDetailComponent } from "./link-detail.component";

describe("Link detail clipboard route ownership", () => {
  it("does not confirm a prior copy after reusing the detail route and returning to the same link", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let resolve!: () => void;
    const write = jasmine.createSpy("writeText").and.returnValue(new Promise<void>((done) => { resolve = done; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const snack = jasmine.createSpyObj<MatSnackBar>("snack", ["open"]);
    try {
      await TestBed.configureTestingModule({
        providers: [provideRouter([{ path: "links/:id", component: LinkDetailComponent }]),
          { provide: MatSnackBar, useValue: snack },
          { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: () => "owner", selectionGeneration: () => 0 } },
          { provide: ApiService, useValue: { get: (path: string) => Promise.resolve(
            /\/links\/\d+$/.test(path)
              ? { link: { id: Number(path.split("/").pop()), shortUrl: `https://uvh.test/${path.split("/").pop()}` }, rules: [], appeal: null, blockReason: null }
              : path.endsWith("activity") ? { events: [], truncated: false } : null,
          ) } },
        ],
      }).overrideComponent(LinkDetailComponent, { set: { template: "" } }).compileComponents();
      const harness = await RouterTestingHarness.create();
      const first = await harness.navigateByUrl("/links/1", LinkDetailComponent);
      first.copy("https://uvh.test/1");
      expect(first.copyFeedback.phase("https://uvh.test/1", first.copyScope)).toBe("copying");
      const second = await harness.navigateByUrl("/links/2", LinkDetailComponent);
      expect(second).toBe(first); // Angular reuses this component for parameter changes.
      await harness.navigateByUrl("/links/1", LinkDetailComponent);
      resolve(); await harness.fixture.whenStable();
      expect(first.copyFeedback.phase("https://uvh.test/1", first.copyScope)).toBe("idle");
      expect(snack.open).not.toHaveBeenCalled();
    } finally {
      TestBed.resetTestingModule();
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
