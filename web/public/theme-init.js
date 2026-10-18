// Runs before first paint (and satisfies a strict script-src 'self' CSP) so there's no light/dark flash.
try {
  var t = localStorage.getItem("finvara.theme");
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
} catch (e) {}
