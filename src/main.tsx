import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/App";
import { DemoDataProvider } from "./app/providers/DemoDataProvider";
import { PrivacyProvider } from "./app/providers/PrivacyProvider";
import { registerServiceWorker } from "./registerServiceWorker";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <PrivacyProvider>
        <DemoDataProvider>
          <App />
        </DemoDataProvider>
      </PrivacyProvider>
    </HashRouter>
  </React.StrictMode>
);

registerServiceWorker();
