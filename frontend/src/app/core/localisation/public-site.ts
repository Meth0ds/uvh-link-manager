import { InjectionToken } from "@angular/core";
import snapshot from "../../../../../shared/localisation/public-site.config.json";
import type { PublicConfig } from "../services/public-response-decoders";
export interface PublicSiteConfiguration {
  publicOrigin: string;
  appOrigin: string;
  legalIdentity: PublicConfig["legalIdentity"];
}
export const PUBLIC_SITE_CONFIGURATION = new InjectionToken<PublicSiteConfiguration>("UVH_PUBLIC_SITE_CONFIGURATION", {
  providedIn: "root", factory: () => snapshot as PublicSiteConfiguration,
});
