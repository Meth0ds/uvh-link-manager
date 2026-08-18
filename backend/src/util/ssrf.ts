import { lookup } from "node:dns/promises";
import { lookup as lookupCb, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const PRIVATE_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT, RFC 6598)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF protocol assignments)
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6336400, 0xc63364ff], // 198.18.0.0/15 (benchmarking)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
  [0xffff0000, 0xffffffff], // 255.255.255.255/32
];

function isPrivateIpv4(n: number): boolean {
  return PRIVATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Parse a 16-bit group pair (each padded to 4 hex digits) or a dotted quad into a numeric IPv4. */
function ipv4FromText(text: string): number | null {
  if (isIP(text) === 4) {
    return text.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  }
  const groups = text.split(":");
  if (groups.length === 2 && groups[0] && groups[1] && /^[0-9a-f]{1,4}$/i.test(groups[0]) && /^[0-9a-f]{1,4}$/i.test(groups[1])) {
    const n = parseInt(groups[0].padStart(4, "0") + groups[1].padStart(4, "0"), 16);
    if (!Number.isNaN(n)) return n >>> 0;
  }
  return null;
}

/**
 * Extract an embedded IPv4 from IPv6 transition formats that route to IPv4
 * space: IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
 * (64:ff9b::/96), 6to4 (2002::/16) and Teredo (2001::/32, server bits
 * complemented). Attackers control DNS for their own domains and can serve
 * AAAA records in these forms to bypass naive IPv6 filters.
 */
function ipv4EmbeddedIn(ip: string): number | null {
  const l = ip.toLowerCase();
  // IPv4-mapped: ::ffff:a.b.c.d / ::ffff:7f00:1 / 0:0:0:0:0:ffff:...
  const mapped = l.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/);
  if (mapped) return ipv4FromText(mapped[1]!);
  // IPv4-compatible (deprecated but resolvable): ::a.b.c.d
  const compat = l.match(/^::([0-9a-f:]+)$/);
  if (compat && !compat[1]!.includes(":")) return ipv4FromText(compat[1]!);
  // NAT64 well-known prefix 64:ff9b::/96
  if (l.startsWith("64:ff9b::")) return ipv4FromText(l.slice(9));
  // 6to4: 2002:V4H:V4L::/48
  if (l.startsWith("2002:")) {
    const groups = l.split(":");
    if (groups.length >= 3) return ipv4FromText(groups[1]! + ":" + groups[2]!);
  }
  // Teredo 2001:0000::/32 — server IPv4 is the complement of the last 32 bits
  if (l.startsWith("2001:0000:") || l.startsWith("2001:0:")) {
    const groups = l.split(":");
    if (groups.length === 8) {
      const n = ipv4FromText(groups[6]! + ":" + groups[7]!);
      if (n !== null) return (n ^ 0xffffffff) >>> 0;
    }
  }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    return isPrivateIpv4(n);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::0") return true; // unspecified → local
    if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    if (lower.startsWith("ff")) return true; // multicast ff00::/8
    if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return true; // documentation 2001:db8::/32
    const embedded = ipv4EmbeddedIn(lower);
    if (embedded !== null) return isPrivateIpv4(embedded);
    return false;
  }
  return true;
}

/**
 * Resolve every IP for a host and reject if any is private/loopback/link-local
 * (covers DNS rebinding on the resolution side). Callers must also re-check
 * after each redirect hop.
 */
export async function assertSafeHost(hostname: string): Promise<void> {
  if (!hostname) throw new Error("SSRF: host vacío");
  try {
    const records = await lookup(hostname, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new Error("SSRF: destino interno bloqueado");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SSRF:")) throw err;
    throw new Error("SSRF: no se pudo resolver el host");
  }
}

/** Validate a URL for server-side fetching: scheme + SSRF + port restrictions. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SSRF: esquema no permitido");
  }
  // Embedded credentials would be sent to the fetched host (and could bypass
  // the allowlist via a different authority). Never fetch URLs with them.
  if (url.username || url.password) {
    throw new Error("SSRF: credenciales embebidas no permitidas");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8080, 8443].includes(port)) {
    throw new Error("SSRF: puerto no permitido");
  }
  await assertSafeHost(url.hostname);
  return url;
}

/**
 * Custom DNS lookup that re-validates every resolved address at *connect*
 * time. The separate assertSafeHost() check happens earlier; validating again
 * inside the connect lookup closes the TOCTOU window a rebinding attacker
 * could exploit between validation and the actual connection.
 */
const safeLookup: LookupFunction = (hostname, _options, callback) => {
  lookupCb(hostname, { all: true }, (err, records: LookupAddress[]) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const bad = records.find((r) => isPrivateIp(r.address));
    if (bad) {
      callback(new Error("SSRF: destino interno bloqueado"), "", 0);
      return;
    }
    const first = records[0]!;
    callback(null, first.address, first.family);
  });
};

export interface SafeFetchResult {
  status: number | null;
  ok: boolean;
}

/**
 * Server-side fetch hardened for SSRF: no redirect following, connect-time IP
 * re-validation and a hard timeout. Used for user-controlled webhook URLs.
 */
export function safeFetch(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  // node:http skips the custom lookup when the hostname is already a literal
  // IP, so validate it here explicitly before connecting.
  if (isIP(url.hostname) !== 0 && isPrivateIp(url.hostname)) {
    return Promise.reject(new Error("SSRF: destino interno bloqueado"));
  }
  const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body) headers["Content-Length"] = String(Buffer.byteLength(init.body));
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return new Promise((resolve, reject) => {
    const req = mod(
      {
        hostname: url.hostname,
        port,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers,
        lookup: safeLookup,
        timeout: init.timeoutMs ?? 5000,
      },
      (res) => {
        res.resume(); // drain; the body is not needed
        const status = res.statusCode ?? null;
        resolve({ status, ok: status !== null && status >= 200 && status < 300 });
      },
    );
    req.on("timeout", () => req.destroy(new Error("SSRF: timeout de la petición")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
