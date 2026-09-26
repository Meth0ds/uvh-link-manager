import type { NotificationItem, NotificationPreference } from "../models";
import {
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_KINDS,
  type NotificationCategory,
  type NotificationDelivery,
  type NotificationKind,
} from "../notification-kinds";
import { boundedArray, integer, literal, nullableInteger, nullableText, record, text } from "./response-decoder-helpers";

const KINDS: ReadonlySet<NotificationKind> = new Set(Object.keys(NOTIFICATION_KINDS) as NotificationKind[]);
const DELIVERIES: ReadonlySet<NotificationDelivery> = new Set(NOTIFICATION_DELIVERIES);
const CATEGORIES: ReadonlySet<NotificationCategory> = new Set(["mandatory", "operational"]);

/** ISO UTC ("…Z") que Date.parse entiende; nada más se acepta como fecha. */
function timestamp(value: unknown, contract: string, nullable = true): string | null {
  const decoded = nullable ? nullableText(value, contract, 64) : text(value, contract, 64);
  if (decoded !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(decoded) || !Number.isFinite(Date.parse(decoded)))) {
    throw new Error(`Invalid ${contract} response`);
  }
  return decoded;
}

/** Ruta interna del panel o null; jamás una URL absoluta ni una con credenciales. */
function route(value: unknown, contract: string): string | null {
  const decoded = nullableText(value, contract, 160);
  if (decoded !== null && (!decoded.startsWith("/app/") || decoded.includes("?") || decoded.includes("#"))) {
    throw new Error(`Invalid ${contract} response`);
  }
  return decoded;
}

export interface NotificationInboxPage {
  notifications: NotificationItem[];
  unread: number;
  nextCursor: number | null;
}

/** La bandeja acota a la página del servidor; nunca se amplía en el cliente. */
export function decodeNotificationInbox(value: unknown): NotificationInboxPage {
  const source = record(value, "notification inbox");
  return {
    notifications: boundedArray(source["notifications"], "notification inbox rows", 20).map((item) => {
      const row = record(item, "notification row");
      return {
        id: integer(row["id"], "notification id", 1),
        kind: literal(row["kind"], KINDS, "notification kind"),
        subject: nullableText(row["subject"], "notification subject", 120),
        workspaceId: nullableInteger(row["workspaceId"], "notification workspace", 1),
        route: route(row["route"], "notification route"),
        createdAt: timestamp(row["createdAt"], "notification timestamp", false)!,
        readAt: timestamp(row["readAt"], "notification timestamp"),
      };
    }),
    unread: integer(source["unread"], "notification unread"),
    nextCursor: nullableInteger(source["nextCursor"], "notification cursor", 1),
  };
}

export function decodeNotificationUnread(value: unknown): { unread: number } {
  const source = record(value, "notification unread");
  return { unread: integer(source["unread"], "notification unread") };
}

/**
 * Preferencias: todo el catálogo, con la categoría declarada por el servidor
 * cruzada contra el espejo local. Una categoría que no cuadra es deriva entre
 * backend y frontend y se rechaza en vez de presentarla en pantalla.
 */
export function decodeNotificationPreferences(value: unknown): { preferences: NotificationPreference[] } {
  const source = record(value, "notification preferences");
  const rows = boundedArray(source["preferences"], "notification preferences", 64).map((item) => {
    const row = record(item, "notification preference");
    const kind = literal(row["kind"], KINDS, "notification preference kind");
    const category = literal(row["category"], CATEGORIES, "notification preference category");
    if (category !== NOTIFICATION_KINDS[kind].category) invalidCategory(kind);
    return {
      kind,
      category,
      delivery: literal(row["delivery"], DELIVERIES, "notification preference delivery"),
    };
  });
  return { preferences: rows };
}

function invalidCategory(kind: NotificationKind): never {
  throw new Error(`Invalid notification preference category for ${kind}`);
}
