/**
 * Entry. Fonts are self-hosted and only the four weights actually used are
 * loaded, so there is no third-party request and no late webfont shift. Styles
 * come in four layers, in order: tokens, base, components, layout, screens.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/jetbrains-mono/500.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/screens.css";

import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("CommitIt: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
