export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }

  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(swUrl).catch((error: unknown) => {
      console.warn("Bluehour service worker registration failed", error);
    });
  });
}
