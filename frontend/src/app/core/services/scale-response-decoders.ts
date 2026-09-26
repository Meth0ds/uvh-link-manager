import type {
  BulkAction,
  BulkActionResponse,
  CollectionDto,
  CollectionsResponse,
  ImportReport,
  ImportRowError,
  LinkTemplateDto,
  LinkTemplatePayload,
  LinkTemplatesResponse,
  TagDto,
  TagsResponse,
} from "../models";
import {
  boolean,
  boundedArray,
  httpUrl,
  integer,
  invalid,
  literal,
  nullableInteger,
  nullableMultiline,
  nullableText,
  record,
  text,
} from "./response-decoder-helpers";

const BULK_ACTIONS = new Set<BulkAction>([
  "pause", "activate", "archive", "trash", "restore", "tag", "untag", "move",
]);

/** The server reports at most 100 row errors and flags the rest as truncated. */
const MAX_IMPORT_ERRORS = 100;

function namedCount(value: unknown, contract: string, maximum: number): { id: number; name: string; links: number } {
  const source = record(value, contract);
  return {
    id: integer(source["id"], contract, 1),
    name: text(source["name"], contract, maximum),
    links: integer(source["links"], contract),
  };
}

export function decodeTagsResponse(value: unknown): TagsResponse {
  const source = record(value, "tags response");
  const tags = boundedArray(source["tags"], "tags response", 500).map((tag): TagDto => namedCount(tag, "tag", 40));
  if (new Set(tags.map((tag) => tag.name.toLocaleLowerCase())).size !== tags.length) invalid("tag names");
  return { tags };
}

export function decodeTagRenameResponse(value: unknown): { ok: boolean; id: number; name: string } {
  const source = record(value, "tag rename");
  return {
    ok: boolean(source["ok"], "tag rename"),
    id: integer(source["id"], "tag rename", 1),
    name: text(source["name"], "tag rename", 40),
  };
}

export function decodeTagMergeResponse(value: unknown): { ok: boolean; id: number; name: string; moved: number } {
  const source = record(value, "tag merge");
  return {
    ok: boolean(source["ok"], "tag merge"),
    id: integer(source["id"], "tag merge", 1),
    name: text(source["name"], "tag merge", 40),
    moved: integer(source["moved"], "tag merge"),
  };
}

export function decodeCollectionsResponse(value: unknown): CollectionsResponse {
  const source = record(value, "collections response");
  const collections = boundedArray(source["collections"], "collections response", 500)
    .map((collection): CollectionDto => namedCount(collection, "collection", 60));
  if (new Set(collections.map((collection) => collection.name.toLocaleLowerCase())).size !== collections.length) {
    invalid("collection names");
  }
  return { collections };
}

export function decodeCollectionResponse(value: unknown): { collection: CollectionDto } {
  const source = record(value, "collection response");
  return { collection: namedCount(source["collection"], "collection", 60) };
}

export function decodeCollectionMutationResponse(value: unknown): { ok: boolean; id: number; name: string } {
  const source = record(value, "collection mutation");
  return {
    ok: boolean(source["ok"], "collection mutation"),
    id: integer(source["id"], "collection mutation", 1),
    name: text(source["name"], "collection mutation", 60),
  };
}

export function decodeCollectionDeleteResponse(value: unknown): { ok: boolean; moved: number } {
  const source = record(value, "collection delete");
  return { ok: boolean(source["ok"], "collection delete"), moved: integer(source["moved"], "collection delete") };
}

/**
 * A template payload speaks the link-create contract (snake_case). Keys the
 * decoder does not know are ignored, like every other response contract here;
 * the ones it does know must hold their shape, because the payload is applied
 * straight into the create form.
 */
function templatePayload(value: unknown): LinkTemplatePayload {
  const source = record(value, "link template payload");
  const payload: LinkTemplatePayload = {};
  if (source["destination"] !== undefined) payload.destination = httpUrl(source["destination"], "template destination");
  if (source["fallback_destination"] !== undefined) {
    payload.fallback_destination = source["fallback_destination"] === null
      ? null : httpUrl(source["fallback_destination"], "template fallback destination");
  }
  if (source["notes"] !== undefined) payload.notes = nullableMultiline(source["notes"], "template notes", 1000, true);
  if (source["tags"] !== undefined) {
    payload.tags = boundedArray(source["tags"], "template tags", 20).map((tag) => text(tag, "template tag", 40));
    if (new Set((payload.tags ?? []).map((tag) => tag.toLocaleLowerCase())).size !== (payload.tags ?? []).length) {
      invalid("template tags");
    }
  }
  if (source["utm"] !== undefined) {
    const utm = record(source["utm"], "template UTM");
    payload.utm = {
      source: nullableText(utm["source"], "template UTM source", 100, true),
      medium: nullableText(utm["medium"], "template UTM medium", 100, true),
      campaign: nullableText(utm["campaign"], "template UTM campaign", 100, true),
      term: nullableText(utm["term"], "template UTM term", 100, true),
      content: nullableText(utm["content"], "template UTM content", 100, true),
    };
  }
  if (source["max_clicks"] !== undefined) payload.max_clicks = nullableInteger(source["max_clicks"], "template max clicks", 1);
  if (source["single_use"] !== undefined) payload.single_use = boolean(source["single_use"], "template single use");
  if (source["scheduled_at"] !== undefined) payload.scheduled_at = nullableText(source["scheduled_at"], "template schedule", 64);
  if (source["expires_at"] !== undefined) payload.expires_at = nullableText(source["expires_at"], "template expiry", 64);
  if (source["collection_id"] !== undefined) {
    payload.collection_id = source["collection_id"] === null
      ? null : integer(source["collection_id"], "template collection", 1);
  }
  return payload;
}

function template(value: unknown): LinkTemplateDto {
  const source = record(value, "link template");
  return {
    id: integer(source["id"], "link template", 1),
    name: text(source["name"], "link template", 60),
    payload: templatePayload(source["payload"]),
    createdAt: text(source["createdAt"], "link template creation timestamp", 64),
  };
}

export function decodeTemplatesResponse(value: unknown): LinkTemplatesResponse {
  const source = record(value, "link templates response");
  return { templates: boundedArray(source["templates"], "link templates response", 200).map(template) };
}

export function decodeTemplateResponse(value: unknown): { template: LinkTemplateDto } {
  const source = record(value, "link template response");
  return { template: template(source["template"]) };
}

export function decodeBulkActionResponse(value: unknown): BulkActionResponse {
  const source = record(value, "bulk action response");
  return {
    ok: boolean(source["ok"], "bulk action response"),
    action: literal(source["action"], BULK_ACTIONS, "bulk action"),
    applied: integer(source["applied"], "bulk action response"),
  };
}

export function decodeImportReport(value: unknown): ImportReport {
  const source = record(value, "import report");
  const errors = boundedArray(source["errors"], "import report", MAX_IMPORT_ERRORS).map((item): ImportRowError => {
    const row = record(item, "import row error");
    return {
      row: integer(row["row"], "import row error", 1),
      error: text(row["error"], "import row error", 500),
    };
  });
  return {
    dryRun: boolean(source["dryRun"], "import report"),
    valid: integer(source["valid"], "import report"),
    created: integer(source["created"], "import report"),
    errors,
    truncated: boolean(source["truncated"], "import report"),
  };
}
