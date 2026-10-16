const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";

module.exports = {
  "/api": {
    target: BACKEND,
    secure: false,
    changeOrigin: false,
    logLevel: "warn",
  },
  "/a/": { target: BACKEND, secure: false, changeOrigin: false },
  "/app-links/": { target: BACKEND, secure: false, changeOrigin: false },
  "/r/": {
    target: BACKEND,
    secure: false,
    changeOrigin: false,
    logLevel: "warn",
  },
  "/health": {
    target: BACKEND,
    secure: false,
    changeOrigin: false,
    logLevel: "warn",
  },
};
