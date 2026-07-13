import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/docs")({
  head: () => ({
    scripts: [
      {
        src: "https://cdn.jsdelivr.net/npm/@scalar/api-reference",
      },
    ],
  }),
  component: DocsRoute,
});

declare global {
  interface Window {
    Scalar?: {
      createApiReference: (
        target: string | HTMLElement,
        config: Record<string, unknown>,
      ) => void;
    };
  }
}

function DocsRoute() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container || !window.Scalar) return;

    container.innerHTML = "";
    window.Scalar.createApiReference(container, {
      url: "/api/rpc/api-reference/spec.json",
      authentication: {
        securitySchemes: {
          bearerAuth: {
            token: "",
          },
        },
      },
    });
  }, []);

  return (
    <div className="min-h-screen">
      <div ref={ref} id="scalar-api-reference" />
    </div>
  );
}
