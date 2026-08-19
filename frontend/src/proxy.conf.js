const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";

module.exports = {
  "/api": {
    target: BACKEND,
    secure: false,
    changeOrigin: true,
    logLevel: "warn",
  },
  "/r": {
    target: BACKEND,
    secure: false,
    changeOrigin: true,
    logLevel: "warn",
  },
  "/health": {
    target: BACKEND,
    secure: false,
    changeOrigin: true,
    logLevel: "warn",
  },
};
