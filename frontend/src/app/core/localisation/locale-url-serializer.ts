import { Injectable } from "@angular/core";
import { DefaultUrlSerializer, type UrlTree } from "@angular/router";
import { routePath } from "./locale";

/** One canonical public route map for links, guards and imperative navigation. */
@Injectable()
export class LocaleUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    return super.parse(routePath(url));
  }

  override serialize(tree: UrlTree): string {
    return routePath(super.serialize(tree));
  }
}
