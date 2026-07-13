import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/docs")({
  head: () => ({
    links: [
      {
        rel: "stylesheet",
        href: "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css",
      },
    ],
  }),
  component: DocsRoute,
});

const SWAGGER_BUNDLE_URL =
  "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).SwaggerUIBundle) {
      resolve();
      return;
    }
    const existing = document.querySelector(
      `script[src="${url}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(), { once: true });
    document.body.appendChild(script);
  });
}

function DocsRoute() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let cancelled = false;

    loadScript(SWAGGER_BUNDLE_URL).then(() => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SwaggerUIBundle = (window as any).SwaggerUIBundle;
      if (!SwaggerUIBundle || !container) return;
      container.innerHTML = "";
      SwaggerUIBundle({
        url: "/api/rpc/api-reference/spec.json",
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: "BaseLayout",
        persistAuthorization: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen p-4">
      <div ref={ref} id="swagger-ui" />
    </div>
  );
}
