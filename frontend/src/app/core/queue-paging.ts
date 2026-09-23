import { computed, signal, type DestroyRef, type Signal, type WritableSignal } from "@angular/core";
import { apiMessage } from "./api-message";
import { LatestRequest } from "./services/latest-request";

/** One page as the API answered it: its rows and how many exist in total. */
export interface QueuePage<Row> {
  rows: Row[];
  total: number;
}

/** How a queue reads a page, and what it says when the read fails. */
export interface QueuePagingOptions<Row> {
  /** The filters this queue pages through, as the identity of one request. */
  filters: () => unknown;
  /** Read one page. The signal cancels a read whose question has been replaced. */
  read: (page: number, perPage: number, signal: AbortSignal) => Promise<QueuePage<Row>>;
  /** Shown when the failure carries no message of its own. */
  fallback: string;
  /** How a failure becomes a sentence; the console passes its own reading. */
  message?: (error: unknown, fallback: string) => string;
  pageSize?: number;
  destroyRef: DestroyRef;
}

/**
 * The read side of a queue: which page is on screen, whether it is still
 * arriving, what went wrong and which answer is the current one.
 *
 * This is the part of every paged list that has nothing to do with what the
 * rows look like or what they are: the same bookkeeping was written once per
 * queue (six in the console, three in moderation) and a change to it — the
 * cancel-on-supersede rule, the flags an action waits for — landed in all of
 * them or in none. A queue now declares its filters and its request and gets
 * the rest from here.
 */
export class QueuePaging<Row> implements QueuePagingView {
  readonly rows = signal<Row[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly pageSize: WritableSignal<number>;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** How many rows the page on screen holds: what the empty state asks. */
  readonly count = computed(() => this.rows().length);

  /**
   * The page on screen is being replaced, so nothing on it may act and no count
   * derived from it may be presented as the answer.
   */
  readonly stale = computed(() => this.loading() || this.error() !== null);

  private readonly requests: LatestRequest;
  private readonly message: (error: unknown, fallback: string) => string;

  constructor(private readonly options: QueuePagingOptions<Row>) {
    this.pageSize = signal(options.pageSize ?? 25);
    this.message = options.message ?? apiMessage;
    this.requests = new LatestRequest(options.destroyRef);
  }

  /** Read the current page, with the filters as they are now. */
  async load(): Promise<void> {
    const page = this.page() + 1;
    const perPage = this.pageSize();
    // The filters are part of the identity of the request: an answer that lands
    // after they changed describes rows nobody asked for.
    const context = JSON.stringify([this.options.filters(), page, perPage]);
    const request = this.requests.begin(context);
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.options.read(page, perPage, request.signal);
      if (!this.requests.isCurrent(request, context)) return;
      this.rows.set(result.rows);
      this.total.set(result.total);
    } catch (error) {
      if (!this.requests.isCurrent(request, context)) return;
      this.error.set(this.message(error, this.options.fallback));
    } finally {
      if (this.requests.isCurrent(request, context)) this.loading.set(false);
    }
  }

  /**
   * The question changed — a search or a filter — so the answer on screen is
   * about other rows: go back to the first page and read it.
   */
  restart(): void {
    this.page.set(0);
    void this.load();
  }

  /** The operator asked for another page or another page size. */
  goTo(pageIndex: number, pageSize: number): void {
    this.page.set(pageIndex);
    this.pageSize.set(pageSize);
    void this.load();
  }
}

/**
 * What a queue frame needs to render one queue's progress, notice, empty state
 * and pager: the read side of the list, with none of its rows.
 */
export interface QueuePagingView {
  readonly count: Signal<number>;
  readonly total: Signal<number>;
  readonly page: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;
  load: () => Promise<void>;
  goTo: (pageIndex: number, pageSize: number) => void;
}
