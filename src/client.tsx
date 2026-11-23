import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot, createRoot } from "react-dom/client";
import { getRouter } from "./router";
import "./styles.css";

const router = getRouter();

const rootElement = document.getElementById("root");
if (rootElement) {
  if (rootElement.hasChildNodes()) {
    hydrateRoot(rootElement, <StartClient router={router} />);
  } else {
    const root = createRoot(rootElement);
    root.render(<StartClient router={router} />);
  }
}
