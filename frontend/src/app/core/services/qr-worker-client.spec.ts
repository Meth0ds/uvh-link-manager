import { validateQrWorkerUrl } from "./qr-worker-client";

describe("QR worker resource boundary", () => {
  const origin = "https://uvh.test", moduleUrl = new URL(`${origin}/app/chunk-fixture.js`);
  const validate = (value: string, development = false) => validateQrWorkerUrl(new URL(value, moduleUrl), moduleUrl, origin, development);

  it("admits the production compiler resource in the module directory", () => {
    expect(() => validate("worker-ABC123.js")).not.toThrow();
  });

  it("admits only the exact Angular worker query in development", () => {
    expect(() => validate("worker-ABC123.js?worker_file&type=module", true)).not.toThrow();
    expect(() => validate("worker-ABC123.js?worker_file&type=module")).toThrow();
    expect(() => validate("worker-ABC123.js?worker_file&type=module&url=https://external.test", true)).toThrow();
  });

  it("rejects external origins, other directories, arbitrary files and URL decorations", () => {
    for (const value of ["https://external.test/app/worker-ABC123.js", "/worker-ABC123.js", "script.js", "worker-ABC123.js?x=1", "worker-ABC123.js#x", "worker-a%2fb.js", "https://user:password@uvh.test/app/worker-ABC123.js", "data:text/javascript,postMessage(1)"]) {
      expect(() => validate(value, true)).withContext(value).toThrow();
    }
    expect(() => validateQrWorkerUrl(new URL("worker-ABC123.js", moduleUrl), moduleUrl, "https://another-page.test", true)).toThrow();
  });
});
