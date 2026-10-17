import { DOCUMENT } from "@angular/common";
import { DestroyRef, Injectable, inject } from "@angular/core";
import { Meta } from "@angular/platform-browser";
import { NavigationEnd, Router, TitleStrategy } from "@angular/router";
import { filter } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { PUBLIC_SITE_CONFIGURATION } from "./public-site";
import { localePath, PUBLIC_ROUTES, UI_LANGUAGE, UI_LOCALE, type PublicRouteId } from "./locale";

@Injectable({providedIn: "root"})
export class PublicSeoService {
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly site = inject(PUBLIC_SITE_CONFIGURATION);
  private readonly router = inject(Router);
  private readonly titles = inject(TitleStrategy);
  private readonly destroy = inject(DestroyRef);
  constructor() {
    this.document.documentElement.setAttribute("lang", UI_LOCALE);
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroy))
      .subscribe(event => this.update(event.urlAfterRedirects));
  }
  private update(url: string): void {
    const path = url.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
    const id = (Object.keys(PUBLIC_ROUTES) as PublicRouteId[]).find(key => PUBLIC_ROUTES[key][UI_LANGUAGE] === path);
    this.document.head.querySelectorAll('link[data-uvh-locale-seo]').forEach(link => link.remove());
    this.meta.updateTag({name: "robots", content: id ? "index, follow" : "noindex, nofollow"});
    if (!id) {
      for (const property of ["og:url", "og:title", "og:description", "og:locale"]) this.meta.removeTag(`property="${property}"`);
      for (const name of ["twitter:title", "twitter:description", "twitter:card"]) this.meta.removeTag(`name="${name}"`);
      return;
    }
    const absolute = (language: "es"|"en") => this.site.publicOrigin.replace(/\/$/, "") + localePath(PUBLIC_ROUTES[id][language], language);
    this.link("canonical", absolute(UI_LANGUAGE));
    for (const [language, href] of [["es",absolute("es")],["en-GB",absolute("en")],["en",absolute("en")],["x-default",absolute("es")]]) this.link("alternate",href,language);
    const description = this.description(id);
    // NavigationEnd fires before the router's document-title update. Read the
    // resolved route title, so prerendered social tags cannot retain index.html's title.
    const title = this.titles.buildTitle(this.router.routerState.snapshot) ?? this.document.title;
    this.meta.updateTag({name:"description",content:description});
    this.meta.updateTag({property:"og:description",content:description});
    this.meta.updateTag({property:"og:title",content:title});
    this.meta.updateTag({property:"og:url",content:absolute(UI_LANGUAGE)});
    this.meta.updateTag({property:"og:locale",content:UI_LANGUAGE === "en" ? "en_GB" : "es_ES"});
    this.meta.updateTag({name:"twitter:card",content:"summary"});
    this.meta.updateTag({name:"twitter:title",content:title});
    this.meta.updateTag({name:"twitter:description",content:description});
  }
  private link(rel: string, href: string, language?: string): void {
    const element = this.document.createElement("link");
    element.rel = rel; element.href = href;
    element.setAttribute("data-uvh-locale-seo", "");
    if (language) element.hreflang = language;
    this.document.head.appendChild(element);
  }
  private description(id: PublicRouteId): string {
    switch (id) {
      case "home": return $localize`:@@seo.home.description:Crea enlaces cortos, actualiza su destino y consulta sus visitas. Organiza enlaces, QR y campañas con tu equipo en UVH.`;
      case "help": return $localize`:@@seo.help.description:Aprende a crear y gestionar enlaces, códigos QR, dominios y campañas en UVH. Encuentra respuestas y ayuda para tu cuenta.`;
      case "status": return $localize`:@@seo.status.description:Consulta el estado de los servicios de UVH y los incidentes operativos publicados.`;
      case "terms": return $localize`:@@seo.terms.description:Consulta las condiciones de uso de UVH, las responsabilidades del servicio y las normas para compartir enlaces.`;
      case "privacy": return $localize`:@@seo.privacy.description:Conoce cómo UVH trata tus datos personales, qué derechos tienes y cómo gestionar tus preferencias de privacidad.`;
      case "reportAbuse": return $localize`:@@seo.report.description:Comunica un enlace de UVH que pueda incumplir las normas o contener contenido ilícito mediante el formulario de denuncia.`;
    }
  }
}
