import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { registerAppCommands } from "./commands/appCommands";
import { App } from "./ui";

registerAppCommands();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
