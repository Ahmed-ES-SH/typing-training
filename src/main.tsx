import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { dbSmokeTest } from "./lib/db/client";
import "./styles.css";

// Open the database at startup: tauri-plugin-sql applies the versioned
// migrations inside Rust on first load, and we enable WAL + FK pragmas.
// Failures are logged, never fatal (UI surfaces persistence errors later).
void dbSmokeTest().catch((error) => {
  console.error("[db] startup initialization failed:", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
