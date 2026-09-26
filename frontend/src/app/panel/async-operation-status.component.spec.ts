import { Component, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { AsyncOperationStatusComponent, type AsyncOperationTone } from "./async-operation-status.component";

@Component({
  imports: [AsyncOperationStatusComponent],
  template: `
    <app-async-operation-status [tone]="tone()" icon="hourglass_top" [waitSeconds]="waitSeconds()">
      <p class="projected">Estamos preparando tus datos</p>
    </app-async-operation-status>
  `,
})
class HostTestComponent {
  readonly tone = signal<AsyncOperationTone>("working");
  readonly waitSeconds = signal(0);
}

describe("AsyncOperationStatusComponent", () => {
  let fixture: ComponentFixture<HostTestComponent>;
  let host: HostTestComponent;
  let root: HTMLElement;
  let section: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostTestComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostTestComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement.querySelector("app-async-operation-status");
    section = root.querySelector(".async-operation") as HTMLElement;
    fixture.detectChanges();
  });

  it("projects caller content and marks the operation busy while working", () => {
    expect(root.querySelector(".projected")?.textContent).toContain("Estamos preparando tus datos");
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.classList).toContain("working");
  });

  it("settles the tone and drops aria-busy", () => {
    host.tone.set("failed");
    fixture.detectChanges();
    expect(section.getAttribute("aria-busy")).toBe("false");
    expect(section.classList).toContain("failed");
  });

  it("shows the wait as a timer that does not auto-retry", () => {
    host.waitSeconds.set(60);
    fixture.detectChanges();
    const timer = root.querySelector('[role="timer"]');
    expect(timer?.getAttribute("aria-live")).toBe("off");
    expect(timer?.textContent?.trim()).toBe("1 min 0 s");
    expect(root.textContent).toContain("Reintento disponible en");
    expect(root.textContent).toContain("No se reintentará automáticamente.");
  });

  it("renders no countdown when there is no wait to show", () => {
    host.waitSeconds.set(0);
    fixture.detectChanges();
    expect(root.querySelector('[role="timer"]')).toBeNull();
    expect(root.textContent).not.toContain("No se reintentará automáticamente.");
  });
});
