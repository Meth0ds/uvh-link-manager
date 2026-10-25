import type { ApiService } from "../../core/services/api.service";
import { decodeRecoverySnapshot, decodeRecoveryTicket } from "../../core/services/recovery-response-decoder";

/** Stateless transport. Credentials and one-use tickets stay in their caller. */
export class RecoveryAdminApi {
  constructor(private readonly api: ApiService) {}

  snapshot(signal: AbortSignal) {
    return this.api.get("/api/v1/admin/updates", undefined, decodeRecoverySnapshot, { signal });
  }

  backup(password: string, factorCode: string) {
    return this.api.post("/api/v1/admin/updates/backup", {
      requestId: crypto.randomUUID(), target: { tag: "manual" }, password, factorCode,
    });
  }

  check() {
    return this.api.post("/api/v1/admin/updates/check", { requestId: crypto.randomUUID(), target: {} });
  }

  access(password: string, factorCode: string) {
    return this.api.post("/api/v1/admin/updates/access", { password, factorCode }, decodeRecoveryTicket);
  }
}
