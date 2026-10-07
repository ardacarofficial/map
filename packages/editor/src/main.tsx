import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { registerAppCommands } from "./commands/appCommands";
import { registerExportCommands } from "./commands/exportCommands";
import { installAutoExport } from "./export/exportActions";
import { App } from "./ui";

registerAppCommands();
registerExportCommands();
installAutoExport();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
