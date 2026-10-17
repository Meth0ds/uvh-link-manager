import { Injectable } from "@angular/core";
import { MatPaginatorIntl } from "@angular/material/paginator";

/**
 * Spanish copy for Material's paginator.
 *
 * Angular Material owns the paginator's wording and ships it in English, so
 * every `<mat-paginator>` (links, trash, team, settings and the admin console)
 * rendered "Items per page:" / "1 – 37 of 37" / "First page" next to Spanish
 * copy, and its controls reached screen readers in English too. Replacing the
 * intl once in `panelRoutes` keeps a single owner for those strings without
 * loading private pagination dependencies on the public website.
 */
// The decorator is required even without `providedIn`: Angular deprecated
// inheriting the injectable metadata from a base class, so the class has to own
// one before that deprecation becomes an error.
@Injectable()
export class SpanishPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = $localize`:@@ui.2f202c718417be:Elementos por página:`;
  override nextPageLabel = $localize`:@@ui.9dd6b398421db4:Página siguiente`;
  override previousPageLabel = $localize`:@@ui.9bcad734827a84:Página anterior`;
  override firstPageLabel = $localize`:@@ui.977c67cffa60e4:Primera página`;
  override lastPageLabel = $localize`:@@ui.9369fd17b8566b:Última página`;

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return $localize`:@@pagination.emptyRange:0 de ${length}:TOTAL:`;
    const start = page * pageSize;
    return $localize`:@@pagination.range:${start + 1}:START: – ${Math.min(start + pageSize, length)}:END: de ${length}:TOTAL:`;
  };
}
