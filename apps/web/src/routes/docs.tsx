import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/docs")({
  component: DocsRoute,
});

const SPEC_URL = "/api/rpc/api-reference/spec.json";

function DocsRoute() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    iframe.srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0f0f0f; color: #e5e5e5; }
  </style>
</head>
<body>
  <div id="scalar-api-reference"></div>
  <script>
    window.__SPEC_URL__ = ${JSON.stringify(SPEC_URL)};
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest"></script>
  <script>
    window.addEventListener('load', function() {
      if (window.Scalar) {
        Scalar.createApiReference('#scalar-api-reference', {
          url: window.__SPEC_URL__,
          baseTheme: 'dark',
          hideDarkModeToggle: true,
          authentication: {
            securitySchemes: {
              bearerAuth: { token: '' }
            }
          }
        });
      }
    });
  </script>
</body>
</html>`;
  }, []);

  return (
    <div className="min-h-screen">
      <iframe
        ref={ref}
        title="API Reference"
        className="h-screen w-full border-0"
      />
    </div>
  );
}
