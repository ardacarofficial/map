import { startEditor } from "./bootstrap";
import { browserPlatform } from "./platform";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found");

void startEditor(rootElement, { platform: browserPlatform });
