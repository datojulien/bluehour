import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { BluehourDataProvider } from "./app/providers/BluehourDataProvider";
import { PrivacyProvider } from "./app/providers/PrivacyProvider";
import { registerServiceWorker } from "./registerServiceWorker";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <PrivacyProvider>
        <BluehourDataProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BluehourDataProvider>
      </PrivacyProvider>
    </HashRouter>
  </React.StrictMode>
);

registerServiceWorker();
