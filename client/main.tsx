import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans";
import { App } from "./App";
import "./styles.css";

// index.html preloads the font file. Waiting for the face (at most 300 ms) means the first paint
// already uses it, instead of swapping fonts one frame later.
const fontWaitMs = 300;
await Promise.race([
  document.fonts.load('1em "Instrument Sans Variable"'),
  new Promise((resolve) => setTimeout(resolve, fontWaitMs)),
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
