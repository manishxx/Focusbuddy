import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Mount a React app into #root. Shared by every extension page. */
export function mount(app: ReactNode): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root element");
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
