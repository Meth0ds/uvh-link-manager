import { UI_LANGUAGE } from "../core/localisation/locale";
import { LocaleLinkDirective } from "../core/localisation/locale-link.directive";
import { UI_TEXT } from "../core/localisation/template-messages";
import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { TERMS_VERSION } from "../core/legal-documents";
import { RouterLink } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";
import { LegalIdentityService } from "./legal-identity.service";
import { LegalDocumentNavigationComponent, type LegalSection } from "./legal-document-navigation.component";

@Component({
  selector: "app-terms",
  standalone: true,
  imports: [LocaleLinkDirective, LegalShellComponent, RouterLink, LegalDocumentNavigationComponent],
  templateUrl: "./terms.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class TermsComponent {
  readonly uiText = UI_TEXT;
  readonly version = TERMS_VERSION;
  readonly versionCopy = UI_LANGUAGE === "en" ? `/legal/versions/${this.version}/en/terms.html` : `/legal/versions/${this.version}/terminos.html`;
  readonly sections: readonly LegalSection[] = [
    { id: "alcance", title: $localize`:@@ui.3181b7423e1540:Alcance y aceptación` },
    { id: "servicio", title: $localize`:@@ui.d9a6f001aa9280:Qué hace UVH` },
    { id: "cuentas", title: $localize`:@@ui.3f97a42b7e0ce4:Cuentas, acceso y seguridad` },
    { id: "workspaces", title: $localize`:@@ui.ecdb42dbd54a83:Workspaces, miembros y permisos` },
    { id: "uso-aceptable", title: $localize`:@@ui.de99bc6b1cfdb1:Uso aceptable` },
    { id: "contenido", title: $localize`:@@ui.80785697dc21b4:Destinos, alias y dominios personalizados` },
    { id: "medidas", title: $localize`:@@ui.ae58fb4c51f0b3:Detección, denuncias y medidas de protección` },
    { id: "limites", title: $localize`:@@ui.efac5028d9fc1c:Cuotas, cambios técnicos y disponibilidad` },
    { id: "datos", title: $localize`:@@ui.20507a4583c711:Datos personales y comunicaciones` },
    { id: "propiedad", title: $localize`:@@ui.8012f601c214b4:Propiedad intelectual y feedback` },
    { id: "terminacion", title: $localize`:@@ui.bd18ae3963ce71:Duración, baja y efectos` },
    { id: "responsabilidad", title: $localize`:@@ui.fa73b5f422ff05:Garantías y responsabilidad` },
    { id: "cambios", title: $localize`:@@ui.6a4c84047acf6e:Cambios en estos Términos` },
    { id: "ley", title: $localize`:@@ui.5d3bc2c34b0171:Ley aplicable, separabilidad y contacto` },
    { id: "integraciones", title: $localize`:@@ui.724f5bbf6c7126:API, tokens y webhooks` },
    { id: "notificaciones-formales", title: $localize`:@@ui.95bdf4f8f6a1d2:Cómo comunicar contenido presuntamente ilícito` },
    { id: "revision", title: $localize`:@@ui.7411f7984c1c9e:Revisión de medidas y recursos` },
    { id: "planes-pago", title: $localize`:@@ui.a9fd8e9d2b133e:Gratuidad actual y futuros planes` },
    { id: "consumo", title: $localize`:@@ui.6567e80b06d7d9:Derechos de las personas consumidoras` },
    { id: "exportacion", title: $localize`:@@ui.b2d025c552795e:Exportación, baja y continuidad de los recursos` },
  ];
  readonly legal = inject(LegalIdentityService);

  constructor() { void this.legal.load(); }
}
