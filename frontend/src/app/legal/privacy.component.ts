import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { PRIVACY_VERSION } from "../core/legal-documents";
import { RouterLink } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";
import { LegalIdentityService } from "./legal-identity.service";
import { LegalDocumentNavigationComponent, type LegalSection } from "./legal-document-navigation.component";

@Component({
  selector: "app-privacy",
  standalone: true,
  imports: [LegalShellComponent, RouterLink, LegalDocumentNavigationComponent],
  templateUrl: "./privacy.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class PrivacyComponent {
  readonly version = PRIVACY_VERSION;
  readonly versionCopy = `/legal/versions/${this.version}/privacidad.html`;
  readonly sections: readonly LegalSection[] = [
    { id: "responsable", title: "Responsable del tratamiento" },
    { id: "datos-tratados", title: "Qué datos tratamos y de dónde proceden" },
    { id: "finalidades", title: "Finalidades y fundamentos del tratamiento" },
    { id: "analitica", title: "Qué ocurre al visitar un enlace" },
    { id: "captcha", title: "Verificación antiabuso mediante hCaptcha" },
    { id: "cookies", title: "Cookies y almacenamiento del navegador" },
    { id: "destinatarios", title: "Destinatarios y encargados" },
    { id: "transferencias", title: "Transferencias internacionales" },
    { id: "conservacion", title: "Conservación y eliminación" },
    { id: "derechos", title: "Tus derechos" },
    { id: "seguridad", title: "Medidas de seguridad" },
    { id: "terceros", title: "Datos que introduces sobre terceros" },
    { id: "menores", title: "Menores de edad" },
    { id: "cambios-privacidad", title: "Cambios y contacto" },
    { id: "procedencia", title: "Información sobre personas sin cuenta" },
    { id: "roles-tratamiento", title: "Workspaces y tratamiento por encargo" },
    { id: "automatizacion", title: "Reglas y decisiones automatizadas" },
    { id: "preferencias", title: "Control de cookies y preferencias" },
    { id: "correo", title: "Correo operativo e invitaciones" },
    { id: "actualizaciones", title: "Cambios de política y registro de versiones" },
  ];
  readonly legal = inject(LegalIdentityService);

  constructor() { void this.legal.load(); }
}
