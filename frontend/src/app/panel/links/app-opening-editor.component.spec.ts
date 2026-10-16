import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { AppOpeningEditorComponent } from "./app-opening-editor.component";
import { AppOpeningService } from "../../core/services/app-opening.service";

describe("AppOpeningEditorComponent", () => {
  function setup() {
    const context = signal("workspace-one");
    const apps = {
      providers: signal(true),
      native: signal(false),
      context,
      capabilities: async () => undefined,
      profile: jasmine.createSpy("profile"),
    };
    TestBed.configureTestingModule({
      imports: [AppOpeningEditorComponent],
      providers: [{ provide: AppOpeningService, useValue: apps }],
    });
    const fixture = TestBed.createComponent(AppOpeningEditorComponent);
    fixture.detectChanges();
    return { fixture, apps, component: fixture.componentInstance };
  }
  it("requires a safe provider URL and lets the visitor keep the web alternative", () => {
    const { component, fixture } = setup();
    component.expanded.set(true);
    component.choose("provider");
    fixture.detectChanges();
    expect(component.validation()).toContain("HTTPS");
    component.setUrl("https://evil.test/track/x");
    expect(component.validation()).toContain("oficial");
    component.setUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(component.validation()).toBe("");
    component.selectPlatform("desktop");
    expect(component.platformCopy()).toContain("destino web");
    component.choose("off");
    expect(component.spec()).toBeNull();
  });
  it("does not apply a late profile from an old workspace", async () => {
    const { fixture, apps, component } = setup();
    let resolve!: (value: unknown) => void;
    apps.profile.and.returnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    fixture.componentRef.setInput("domainId", 4);
    apps.native.set(true);
    fixture.detectChanges();
    apps.context.set("workspace-two");
    resolve({
      domainReady: true,
      profile: { id: "old-profile", enabled: true },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(component.profile()).toBeNull();
    fixture.destroy();
  });
  it("builds official map links from guided places and routes without querying the provider", () => {
    const { component, apps } = setup();
    component.choose("provider");
    component.setProvider("google_maps");
    component.updateMap("destination", "Museo del Prado, Madrid");
    let u = new URL(component.providerUrl());
    expect(u.hostname).toBe("www.google.com");
    expect(u.searchParams.get("query")).toBe("Museo del Prado, Madrid");
    component.updateMap("mode", "route");
    component.updateMap("origin", "Toledo");
    component.updateMap("travel", "walking");
    u = new URL(component.providerUrl());
    expect(u.pathname).toBe("/maps/dir/");
    expect(u.searchParams.get("origin")).toBe("Toledo");
    expect(u.searchParams.get("travelmode")).toBe("walking");
    component.setProvider("apple_maps");
    component.updateMap("mode", "route");
    expect(component.validation()).toContain("destino");
    component.updateMap("destination", "Madrid");
    u = new URL(component.providerUrl());
    expect(u.hostname).toBe("maps.apple.com");
    expect(u.searchParams.get("daddr")).toBe("Madrid");
    expect(component.validation()).toBe("");
    expect(apps.profile).not.toHaveBeenCalled();
  });
  it("keeps route waypoints when editing transport and removes stale place IDs when changing destination", () => {
    const { component } = setup();
    component.choose("provider");
    component.setProvider("google_maps");
    component.setUrl(
      "https://www.google.com/maps/dir/?api=1&destination=Madrid&destination_place_id=old-place&waypoints=Toledo",
    );
    component.updateMap("travel", "walking");
    expect(new URL(component.providerUrl()).searchParams.get("waypoints")).toBe(
      "Toledo",
    );
    component.updateMap("destination", "Segovia");
    const query = new URL(component.providerUrl()).searchParams;
    expect(query.get("waypoints")).toBe("Toledo");
    expect(query.has("destination_place_id")).toBeFalse();
  });
});
