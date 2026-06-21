export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }

  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("bluehour:update-available"));
            }
          });
        });
      })
      .catch((error: unknown) => {
        console.warn("Bluehour service worker registration failed", error);
      });
  });
}
