import { Component, ChangeDetectionStrategy, inject } from "@angular/core";
import { TERMS_VERSION } from "../core/legal-documents";
import { RouterLink } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";
import { LegalIdentityService } from "./legal-identity.service";
import { LegalDocumentNavigationComponent, type LegalSection } from "./legal-document-navigation.component";

@Component({
  selector: "app-terms",
  standalone: true,
  imports: [LegalShellComponent, RouterLink, LegalDocumentNavigationComponent],
  templateUrl: "./terms.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./legal-doc.scss",
})
export class TermsComponent {
  readonly version = TERMS_VERSION;
  readonly versionCopy = `/legal/versions/${this.version}/terminos.html`;
  readonly sections: readonly LegalSection[] = [
    { id: "alcance", title: "Alcance y aceptación" },
    { id: "servicio", title: "Qué hace UVH" },
    { id: "cuentas", title: "Cuentas, acceso y seguridad" },
    { id: "workspaces", title: "Workspaces, miembros y permisos" },
    { id: "uso-aceptable", title: "Uso aceptable" },
    { id: "contenido", title: "Destinos, alias y dominios personalizados" },
    { id: "medidas", title: "Detección, denuncias y medidas de protección" },
    { id: "limites", title: "Cuotas, cambios técnicos y disponibilidad" },
    { id: "datos", title: "Datos personales y comunicaciones" },
    { id: "propiedad", title: "Propiedad intelectual y feedback" },
    { id: "terminacion", title: "Duración, baja y efectos" },
    { id: "responsabilidad", title: "Garantías y responsabilidad" },
    { id: "cambios", title: "Cambios en estos Términos" },
    { id: "ley", title: "Ley aplicable, separabilidad y contacto" },
    { id: "integraciones", title: "API, tokens y webhooks" },
    { id: "notificaciones-formales", title: "Cómo comunicar contenido presuntamente ilícito" },
    { id: "revision", title: "Revisión de medidas y recursos" },
    { id: "planes-pago", title: "Gratuidad actual y futuros planes" },
    { id: "consumo", title: "Derechos de las personas consumidoras" },
    { id: "exportacion", title: "Exportación, baja y continuidad de los recursos" },
  ];
  readonly legal = inject(LegalIdentityService);

  constructor() { void this.legal.load(); }
}
