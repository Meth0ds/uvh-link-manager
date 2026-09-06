import type { PrivacyRightMessage, PrivacyRightRequest, PrivacyRightStatus, PrivacyRightType } from "../models";
import { boolean, boundedArray, integer, invalid, literal, nullableInteger, nullableText, record, text } from "./response-decoder-helpers";

const TYPES = new Set<PrivacyRightType>(["access", "rectification", "erasure", "objection", "restriction", "portability"]);
const STATUSES = new Set<PrivacyRightStatus>(["submitted", "in_progress", "waiting_user", "completed", "rejected", "cancelled"]);
const AUTHOR_ROLES = new Set<PrivacyRightMessage["authorRole"]>(["user", "admin", "system"]);
const EXTENSION_REASONS = new Set<NonNullable<PrivacyRightRequest["extensionReasonCode"]>>(["complexity", "request_volume"]);

export interface PrivacyRequestsPage {
  requests: PrivacyRightRequest[];
  total: number;
  page: number;
  perPage: number;
}

export interface PrivacyPageContext {
  page: number;
  perPage: number;
  admin?: boolean;
}

function message(value: unknown): PrivacyRightMessage {
  const source = record(value, "privacy message");
  return {
    id: integer(source["id"], "privacy message", 1),
    authorRole: literal(source["authorRole"], AUTHOR_ROLES, "privacy message author"),
    body: nullableText(source["body"], "privacy message body", 2000, true),
    createdAt: text(source["createdAt"], "privacy message timestamp", 64),
  };
}

function privacyRequest(value: unknown, admin: boolean): PrivacyRightRequest {
  const source = record(value, "privacy request");
  const extensionReasonCode = source["extensionReasonCode"] === null
    ? null : literal(source["extensionReasonCode"], EXTENSION_REASONS, "privacy extension reason");
  const decoded: PrivacyRightRequest = {
    id: integer(source["id"], "privacy request", 1),
    type: literal(source["type"], TYPES, "privacy request type"),
    status: literal(source["status"], STATUSES, "privacy request status"),
    identityVerifiedAt: nullableText(source["identityVerifiedAt"], "privacy request timestamp", 64),
    acknowledgedAt: nullableText(source["acknowledgedAt"], "privacy request timestamp", 64),
    dueAt: text(source["dueAt"], "privacy request due timestamp", 64),
    extendedUntil: nullableText(source["extendedUntil"], "privacy request timestamp", 64),
    extensionReasonCode,
    completedAt: nullableText(source["completedAt"], "privacy request timestamp", 64),
    cancelledAt: nullableText(source["cancelledAt"], "privacy request timestamp", 64),
    createdAt: text(source["createdAt"], "privacy request timestamp", 64),
    updatedAt: text(source["updatedAt"], "privacy request timestamp", 64),
    overdue: boolean(source["overdue"], "privacy request overdue flag"),
    messages: boundedArray(source["messages"], "privacy messages", 20).map(message),
  };
  if (admin) {
    decoded.userId = nullableInteger(source["userId"], "privacy request user", 1);
    decoded.name = text(source["name"], "privacy request account name", 255);
    decoded.email = nullableText(source["email"], "privacy request account email", 320);
    decoded.assignedAdminName = nullableText(source["assignedAdminName"], "privacy assigned administrator", 255);
  }
  return decoded;
}

/** Decode an entire legal-case page before it can replace account or operator state. */
export function decodePrivacyRequestsPage(value: unknown, expected: PrivacyPageContext): PrivacyRequestsPage {
  const source = record(value, "privacy requests page");
  const page = integer(source["page"], "privacy requests page", 1, 10_000);
  const perPage = integer(source["perPage"], "privacy requests page", 1, 50);
  const total = integer(source["total"], "privacy requests page");
  const requests = boundedArray(source["requests"], "privacy requests page", perPage)
    .map((item) => privacyRequest(item, expected.admin === true));
  if (page !== expected.page || perPage !== expected.perPage || requests.length > total) invalid("privacy requests page context");
  return { requests, total, page, perPage };
}
