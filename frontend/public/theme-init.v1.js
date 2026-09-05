(() => {
  try {
    const preference = localStorage.getItem("uvh.theme");
    const dark = preference === "dark"
      || (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
})();
