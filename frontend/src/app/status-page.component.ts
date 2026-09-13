import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { PublicThemeToggleComponent } from "./core/public-theme-toggle.component";

@Component({
  selector: "app-status-page", standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, PublicThemeToggleComponent],
  templateUrl: "./status-page.component.html",
  styleUrl: "./status-page.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPageComponent {
  private readonly route = inject(ActivatedRoute);
  // The route chooses public copy, never resource metadata or a reflected URL.
  // In particular query strings/fragments may contain single-use bearer links.
  readonly forbidden = this.route.snapshot.data["kind"] === "forbidden";
  readonly code = this.forbidden ? "403" : "404";
  readonly title = this.forbidden ? "Esta puerta necesita permiso." : "Este camino no lleva a una página.";
}
