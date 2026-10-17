import { DOCUMENT } from "@angular/common";
import { Directive, HostBinding, Input, inject } from "@angular/core";
import { localeHref } from "./locale";
import { PUBLIC_SITE_CONFIGURATION } from "./public-site";

/** Native links use the same locale map as the router and SEO. API/assets are untouched. */
// eslint-disable-next-line @angular-eslint/directive-selector -- Locale handling applies to existing native anchors without altering their semantics.
@Directive({ selector: "a[href]", standalone: true })
export class LocaleLinkDirective {
  private readonly document = inject(DOCUMENT);
  private readonly site = inject(PUBLIC_SITE_CONFIGURATION);
  @Input() href: string | null | undefined;
  @HostBinding("attr.href") get localisedHref(): string | null {
    return this.href == null ? null : localeHref(this.href, [this.site.publicOrigin, this.site.appOrigin, this.document.location?.origin ?? ""]);
  }
}
