import { inject, Injectable } from "@angular/core";
import { ApiService, type ApiReadOptions } from "./api.service";
import { validateQrDesign, type QrDesignSpec } from "./qr-design";
import type { QrCustomLogo } from "./qr-custom-logo";

export interface SavedQrDesign { id: number; name: string; spec: QrDesignSpec; version: number; createdAt: string; updatedAt: string }
export interface QrVariant extends SavedQrDesign { linkId: number; publicId: string; archived: boolean }
export interface QrLinkSnapshot { id: number; alias: string; shortUrl: string; state: string }
export interface QrComparison {
  from: string; to: string; timezone: "UTC";
  attributedVisits: number; unattributedVisits: number;
  variants: (QrVariant & { visits: number; attributedPercentage: number | null })[];
  series: { day: string; hasData: boolean; visits: number | null; unattributed: number | null; variants: { id: number; visits: number | null }[] }[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Respuesta QR inválida");
  return value as Record<string, unknown>;
}
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Identificador inválido"); return value; }
function text(value: unknown, max: number): string { if (typeof value !== "string" || [...value].length > max || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Texto inválido"); return value; }
export function decodeSavedQr(value: unknown): SavedQrDesign {
  const row = record(value);
  return { id: positive(row.id), name: text(row.name, 80), spec: validateQrDesign(row.spec), version: positive(row.version), createdAt: text(row.createdAt, 80), updatedAt: text(row.updatedAt, 80) };
}
function decodeVariant(value: unknown): QrVariant {
  const row = record(value), design = decodeSavedQr(row);
  if (typeof row.publicId !== "string" || !/^[a-f0-9]{32}$/.test(row.publicId) || typeof row.archived !== "boolean") throw new Error("Variante inválida");
  return { ...design, linkId: positive(row.linkId), publicId: row.publicId, archived: row.archived };
}

export function decodeQrComparison(value: unknown): QrComparison {
  const row = record(value);
  const count = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Recuento QR inválido");
    return value;
  };
  const day = (value: unknown): string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Fecha QR inválida");
    return value;
  };
  const from = day(row.from), to = day(row.to), attributedVisits = count(row.attributedVisits), unattributedVisits = count(row.unattributedVisits);
  if (row.timezone !== "UTC" || from > to || !Array.isArray(row.variants) || !Array.isArray(row.series) || row.variants.length > 100 || row.series.length > 180) throw new Error("Comparación QR inválida");
  const variants = row.variants.map(value => {
    const raw = record(value), variant = decodeVariant(raw), visits = count(raw.visits), percentage = raw.attributedPercentage;
    if (!(percentage === null || (typeof percentage === "number" && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100))) throw new Error("Porcentaje QR inválido");
    if (attributedVisits === 0 ? percentage !== null : percentage === null || Math.abs(percentage - visits / attributedVisits * 100) > 0.011) throw new Error("Porcentaje QR incoherente");
    return { ...variant, visits, attributedPercentage: percentage };
  });
  if (new Set(variants.map(variant => variant.id)).size !== variants.length || variants.reduce((sum, variant) => sum + variant.visits, 0) !== attributedVisits) throw new Error("Variantes QR incoherentes");
  const series = row.series.map((value, index) => {
    const raw = record(value), date = day(raw.day);
    if (typeof raw.hasData !== "boolean" || date !== new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10) || date > to || !Array.isArray(raw.variants) || raw.variants.length !== variants.length) throw new Error("Serie QR inválida");
    const nullableCount = (value: unknown): number | null => raw.hasData ? count(value) : value === null ? null : (() => { throw new Error("Una fecha sin datos requiere valores nulos"); })();
    const points = raw.variants.map((value, index) => {
      const point = record(value), id = positive(point.id);
      if (id !== variants[index].id) throw new Error("Serie QR incoherente");
      return { id, visits: nullableCount(point.visits) };
    });
    const visits = nullableCount(raw.visits), unattributed = nullableCount(raw.unattributed);
    if (visits !== null && (unattributed ?? 0) + points.reduce((sum, point) => sum + (point.visits ?? 0), 0) !== visits) throw new Error("Visitas QR incoherentes");
    return { day: date, hasData: raw.hasData, visits, unattributed, variants: points };
  });
  if (!series.length || series.at(-1)?.day !== to) throw new Error("Serie QR incompleta");
  if (series.reduce((sum, point) => sum + (point.unattributed ?? 0), 0) !== unattributedVisits
    || variants.some((variant, index) => series.reduce((sum, point) => sum + (point.variants[index].visits ?? 0), 0) !== variant.visits)) throw new Error("Totales de la serie QR incoherentes");
  return { from, to, timezone: "UTC", attributedVisits, unattributedVisits, variants, series };
}

@Injectable({ providedIn: "root" })
export class QrLibraryService {
  private readonly api = inject(ApiService);
  list(options?: ApiReadOptions): Promise<SavedQrDesign[]> {
    return this.api.get("/api/v1/qr-designs", undefined, value => {
      const rows = record(value).designs;
      if (!Array.isArray(rows)) throw new Error("Biblioteca inválida");
      return rows.map(decodeSavedQr);
    }, options);
  }
  create(name: string, spec: QrDesignSpec, key: string): Promise<SavedQrDesign> { return this.api.post("/api/v1/qr-designs", { name, spec }, value => decodeSavedQr(record(value).design), { "Idempotency-Key": key }); }
  update(saved: SavedQrDesign, name: string, spec: QrDesignSpec): Promise<SavedQrDesign> { return this.api.patch(`/api/v1/qr-designs/${saved.id}`, { name, spec, version: saved.version }, value => decodeSavedQr(record(value).design)); }
  delete(saved: SavedQrDesign): Promise<unknown> { return this.api.delete(`/api/v1/qr-designs/${saved.id}`, { version: saved.version }); }
  async upload(file: File, key: string): Promise<number> {
    const form = new FormData(); form.append("logo", file);
    return this.api.upload("/api/v1/qr-assets", form, value => positive(record(record(value).asset).id), { "Idempotency-Key": key });
  }
  logo(id: number, options?: ApiReadOptions): Promise<Blob> { return this.api.getBlob(`/api/v1/qr-assets/${positive(id)}`, undefined, options); }
  async preparedLogo(id: number, name: string, options?: ApiReadOptions): Promise<QrCustomLogo> {
    const blob = await this.logo(id, options);
    options?.signal?.throwIfAborted();
    const { prepareSavedQrLogo } = await import("./qr-custom-logo");
    return prepareSavedQrLogo(blob, name);
  }
  snapshot(ids: readonly number[], options?: ApiReadOptions): Promise<QrLinkSnapshot[]> {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return Promise.reject(new Error("Selecciona entre 1 y 100 enlaces únicos."));
    return this.api.get("/api/v1/links/qr-export", { ids: ids.map(positive).join(",") }, value => {
      const rows = record(value).links;
      if (!Array.isArray(rows) || rows.length !== ids.length) throw new Error("Selección incompleta");
      return rows.map((value, index) => {
        const row = record(value), id = positive(row.id), shortUrl = text(row.shortUrl, 4096);
        if (id !== ids[index] || !["http:", "https:"].includes(new URL(shortUrl).protocol)) throw new Error("Enlace inválido");
        return { id, shortUrl, alias: text(row.alias, 128), state: text(row.state, 32) };
      });
    }, options);
  }
  variants(linkId: number, options?: ApiReadOptions): Promise<QrVariant[]> {
    return this.api.get(`/api/v1/links/${positive(linkId)}/qr-variants`, undefined, value => {
      const rows = record(value).variants; if (!Array.isArray(rows)) throw new Error("Variantes inválidas"); return rows.map(decodeVariant);
    }, options);
  }
  comparison(linkId: number, from: string, to: string, options?: ApiReadOptions): Promise<QrComparison> {
    return this.api.get(`/api/v1/links/${positive(linkId)}/qr-variants/comparison`, { from, to }, decodeQrComparison, options);
  }
  createVariant(linkId: number, name: string, spec: QrDesignSpec, key: string): Promise<QrVariant> {
    return this.api.post(`/api/v1/links/${positive(linkId)}/qr-variants`, { name, spec }, value => decodeVariant(record(value).variant), { "Idempotency-Key": key });
  }
  updateVariant(variant: QrVariant, changes: { spec?: QrDesignSpec; archived?: boolean; name?: string }): Promise<QrVariant> {
    return this.api.patch(`/api/v1/links/${variant.linkId}/qr-variants/${variant.id}`, { version: variant.version, ...changes }, value => decodeVariant(record(value).variant));
  }
}
