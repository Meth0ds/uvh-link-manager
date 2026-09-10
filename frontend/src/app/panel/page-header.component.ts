import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-page-header",
  standalone: true,
  imports: [MatIconModule],
  template: `
    <header class="page-hero">
      <div class="page-heading">
        <span class="page-icon" aria-hidden="true"><mat-icon>{{ icon() }}</mat-icon></span>
        <div class="page-copy">
          <span class="page-eyebrow">{{ eyebrow() }}</span>
          <h1>{{ title() }}</h1>
          <p>{{ description() }}</p>
        </div>
      </div>
      <div class="page-actions"><ng-content /></div>
    </header>
  `,
  styleUrl: "./page-header.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderComponent {
  readonly icon = input.required<string>();
  readonly eyebrow = input("Workspace");
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
