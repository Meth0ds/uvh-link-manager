import { Injectable } from "@angular/core";
import { MatPaginatorIntl } from "@angular/material/paginator";

/**
 * Spanish copy for Material's paginator.
 *
 * Angular Material owns the paginator's wording and ships it in English, so
 * every `<mat-paginator>` (links, trash, team, settings and the admin console)
 * rendered "Items per page:" / "1 – 37 of 37" / "First page" next to Spanish
 * copy, and its controls reached screen readers in English too. Replacing the
 * intl once in `appConfig` keeps a single owner for those strings.
 */
// The decorator is required even without `providedIn`: Angular deprecated
// inheriting the injectable metadata from a base class, so the class has to own
// one before that deprecation becomes an error.
@Injectable()
export class SpanishPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = "Elementos por página:";
  override nextPageLabel = "Página siguiente";
  override previousPageLabel = "Página anterior";
  override firstPageLabel = "Primera página";
  override lastPageLabel = "Última página";

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return `0 de ${length}`;
    const start = page * pageSize;
    return `${start + 1} – ${Math.min(start + pageSize, length)} de ${length}`;
  };
}
