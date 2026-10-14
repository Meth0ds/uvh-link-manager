export type ReportSection = "visits" | "series" | "countries" | "devices";
export interface ReportSpec {
  version: 1;
  title: string;
  description: string;
  period: "7d" | "30d" | "90d" | "custom";
  from: string | null;
  to: string | null;
  sections: ReportSection[];
}
export interface ReportLink {
  linkId: number;
  label: string;
}
export interface AnalyticsReport {
  id: number;
  publicId: string;
  version: number;
  spec: ReportSpec;
  links: ReportLink[];
  passwordProtected: boolean;
  expiresAt: string | null;
  state: "active" | "expired" | "revoked" | "needs_review";
  shareUrl: string;
}
export interface PublicReport {
  version: 1;
  title: string;
  description: string;
  sections: ReportSection[];
  labels: string[];
  from: string;
  to: string;
  updatedAt: string;
  retainedFrom: string;
  visits: number | null;
  series: { day: string; visits: number; available: boolean }[];
  countries: { key: string; value: number }[];
  devices: { key: string; value: number }[];
}
export interface SocialPreviewSpec {
  version: 1;
  enabled: boolean;
  title: string;
  description: string | null;
  imageAssetId: number | null;
  imageAlt: string | null;
}
