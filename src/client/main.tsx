import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../web/static/app.css";
import { App } from "./app.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
