import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

/** Highlight remote text through interpolation, never innerHTML. */
@Component({
  selector: "app-search-highlight", standalone: true,
  template: `@for (part of parts(); track $index) {@if (part.match) {<mark>{{ part.text }}</mark>} @else {<span>{{ part.text }}</span>}}`,
  styles: [`:host{overflow-wrap:anywhere}mark{color:inherit;background:color-mix(in srgb,var(--uvh-ink) 9%,transparent);border-radius:3px;padding:0 1px}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchHighlightComponent {
  readonly text = input(""); readonly query = input("");
  readonly parts = computed(() => {
    const text = this.text(); const query = this.query().trim();
    if (!query) return [{ text, match: false }];
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const parts: { text: string; match: boolean }[] = []; let cursor = 0;
    for (const match of text.matchAll(expression)) {
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), match: false });
      parts.push({ text: match[0], match: true }); cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
    return parts;
  });
}
