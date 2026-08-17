import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6336400, 0xc63364ff], // 198.18.0.0/15 (benchmarking)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
  [0xffff0000, 0xffffffff], // 255.255.255.255/32
];

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    return PRIVATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    );
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
