import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/docs")({
  component: DocsRoute,
});

const SCALAR_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest";

function DocsRoute() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const origin = window.location.origin;
    const specUrl = `${origin}/api/rpc/api-reference/spec.json`;

    iframe.srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <base href="${origin}/" />
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${SCALAR_CDN}/dist/style.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0f0f0f; color: #e5e5e5; }
  </style>
</head>
<body>
  <div id="scalar-api-reference"></div>
  <script>
    (function() {
      var s = document.createElement('script');
      s.src = '${SCALAR_CDN}';
      s.onload = function() {
        Scalar.createApiReference('#scalar-api-reference', {
          url: '${specUrl}',
          baseTheme: 'dark',
          hideDarkModeToggle: true,
          authentication: {
            securitySchemes: {
              bearerAuth: {}
            }
          },
          persistAuth: true
        });
      };
      s.onerror = function() {
        document.getElementById('scalar-api-reference').innerHTML =
          '<p style="color:red;padding:2rem">Failed to load API reference.</p>';
      };
      document.head.appendChild(s);
    })();
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
