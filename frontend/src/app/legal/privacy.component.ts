import { UI_LANGUAGE } from "../core/localisation/locale";
import { LocaleLinkDirective } from "../core/localisation/locale-link.directive";
import { UI_TEXT } from "../core/localisation/template-messages";
import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { PRIVACY_VERSION, legalCopyPath } from "../core/legal-documents";
import { RouterLink } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";
import { LegalIdentityService } from "./legal-identity.service";
import { LegalDocumentNavigationComponent, type LegalSection } from "./legal-document-navigation.component";

@Component({
  selector: "app-privacy",
  standalone: true,
  imports: [LocaleLinkDirective, LegalShellComponent, RouterLink, LegalDocumentNavigationComponent],
  templateUrl: "./privacy.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class PrivacyComponent {
  readonly uiText = UI_TEXT;
  readonly version = PRIVACY_VERSION;
  readonly versionCopy = legalCopyPath(UI_LANGUAGE, "privacy", this.version);
  readonly sections: readonly LegalSection[] = [
    { id: "responsable", title: $localize`:@@ui.76f655e1da1aa0:Responsable del tratamiento` },
    { id: "datos-tratados", title: $localize`:@@ui.770dec81c1537a:Qué datos tratamos y de dónde proceden` },
    { id: "finalidades", title: $localize`:@@ui.edbecc65272f59:Finalidades y fundamentos del tratamiento` },
    { id: "analitica", title: $localize`:@@ui.93ae6882c6ca27:Qué ocurre al visitar un enlace` },
    { id: "captcha", title: $localize`:@@ui.2bdecf76acf6a4:Verificación antiabuso mediante hCaptcha` },
    { id: "cookies", title: $localize`:@@ui.71b9a943231447:Cookies y almacenamiento del navegador` },
    { id: "destinatarios", title: $localize`:@@ui.28e346a41731e0:Destinatarios y encargados` },
    { id: "transferencias", title: $localize`:@@ui.4a8d2e1d90ad89:Transferencias internacionales` },
    { id: "conservacion", title: $localize`:@@ui.219f47893a9d3b:Conservación y eliminación` },
    { id: "derechos", title: $localize`:@@ui.0cce35bcf3a277:Tus derechos` },
    { id: $localize`:@@ui.1ea9f394f510e2:seguridad`, title: $localize`:@@ui.d1d074150c270a:Medidas de seguridad` },
    { id: "terceros", title: $localize`:@@ui.a899bb246df05d:Datos que introduces sobre terceros` },
    { id: "menores", title: $localize`:@@ui.c824c7e3ef598d:Menores de edad` },
    { id: "cambios-privacidad", title: $localize`:@@ui.53c05b85dcf2a8:Cambios y contacto` },
    { id: "procedencia", title: $localize`:@@ui.87e12cf207227a:Información sobre personas sin cuenta` },
    { id: "roles-tratamiento", title: $localize`:@@ui.274fe03d57bbcf:Workspaces y tratamiento por encargo` },
    { id: "automatizacion", title: $localize`:@@ui.d7d57c4b6675b5:Reglas y decisiones automatizadas` },
    { id: "preferencias", title: $localize`:@@ui.b2ecf969d58c92:Control de cookies y preferencias` },
    { id: $localize`:@@ui.31eb60d41c93de:correo`, title: $localize`:@@ui.88b0038f32fe37:Correo operativo e invitaciones` },
    { id: "actualizaciones", title: $localize`:@@ui.bd8f2b1a48dd49:Cambios de política y registro de versiones` },
  ];
  readonly legal = inject(LegalIdentityService);

  constructor() { void this.legal.load(); }
}
