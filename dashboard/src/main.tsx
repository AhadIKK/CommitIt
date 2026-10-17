/**
 * Entry. Fonts are self-hosted and only the weights actually used are
 * loaded, so there is no third-party request and no late webfont shift. Styles
 * come in five layers, in order: tokens, base, components, layout, screens,
 * then the two design languages (ledger, app).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/ledger.css";
import "./styles/app.css";

import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("CommitIt: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
