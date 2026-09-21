import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { MatPaginatorIntl } from "@angular/material/paginator";
import { appConfig, routerFeatures, routes } from "./app.config";
import { SpanishPaginatorIntl } from "./core/paginator-intl";

@Component({ selector: "app-first-screen", standalone: true, template: "primera" })
class FirstScreen {}

@Component({ selector: "app-second-screen", standalone: true, template: "segunda" })
class SecondScreen {}

describe("application routes", () => {
  it("registers the public and authenticated route surfaces", () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toEqual([
      "",
      "auth",
      "legal",
      "help",
      "status",
      "invitations/accept",
      "forbidden",
      "not-found",
      "app",
      "**",
    ]);
  });

  it("keeps the catch-all route last", () => {
    expect(routes.at(-1)?.path).toBe("**");
    expect(routes.find((route) => route.path === "app")?.loadChildren).toBeDefined();
  });

  it("replaces Material's English paginator copy for the whole application", () => {
    const provider = appConfig.providers.find(
      (entry) => (entry as { provide?: unknown })?.provide === MatPaginatorIntl,
    ) as { useClass?: unknown } | undefined;
    expect(provider?.useClass).toBe(SpanishPaginatorIntl);
  });
});

describe("navigation policy", () => {
  it("changes route without starting a view transition", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: "first", component: FirstScreen },
            { path: "second", component: SecondScreen },
          ],
          ...routerFeatures,
        ),
      ],
    });
    const harness = await RouterTestingHarness.create("/first");
    // A browser can expose this method and still skip the transition, which is
    // exactly the case that used to log `InvalidStateError` once per route
    // change. Asserting the call never happens holds in every environment,
    // where asserting the absence of a console line would only hold where the
    // browser happens to honour the transition.
    const start = spyOn(document, "startViewTransition").and.callThrough();

    await harness.navigateByUrl("/second");

    expect(harness.routeNativeElement?.textContent).toContain("segunda");
    expect(start).not.toHaveBeenCalled();
  });
});
