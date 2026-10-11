import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// drop the one-off cache-buster the zoom "Reset" adds (keeps any share-link hash)
{
  const u = new URL(location.href);
  if (u.searchParams.has("_z")) {
    u.searchParams.delete("_z");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable + offline: register the service worker in production, then tell it what the page has loaded.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const urls = [
        "/",
        "/manifest.webmanifest",
        "/icon.svg",
        ...performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.startsWith(location.origin) && !n.includes("/api/")),
      ];
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "precache", urls: [...new Set(urls)] });
    } catch {
      /* offline support is a bonus, never a blocker */
    }
  });
}
