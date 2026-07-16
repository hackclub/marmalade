import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import AsciiMotionAnimation from "../components/ascii-motion-animation";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());

  return (
    <div className="container mx-auto max-w-6xl px-4 py-2">
      <div className="grid gap-6">
        <div className="mx-auto mt-[-100px] max-w-6xl">
          <AsciiMotionAnimation showControls={false} autoPlay={false} />
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 font-mono text-sm">
          <p className="text-md">
            <a href="/" className="text-[#ffa364] hover:underline">
              🍊 (marmalade)
            </a>{" "}
            is a permissionful api access layer for{" "}
            <a
              href="https://letsjelly.com"
              className="text-[#e2366a] hover:underline"
            >
              🍓 (jelly)
            </a>
          </p>
          <ul className="list-inside list-disc pl-6">
            <li>
              made for silliness, freedom, and :3 in{" "}
              <a
                href="https://hackclub.com"
                className="hover:text-[#ec3750] hover:underline"
              >
                hack club
              </a>
            </li>
            <li>
              found something we lost? help us and{" "}
              <a href="/keys/revoke" className="text-[#a1a1a1] hover:underline">
                revoke
              </a>{" "}
              it 🥰
            </li>
          </ul>
        </div>
        <section className="mx-auto w-full max-w-3xl rounded-lg border p-4">
          <h2 className="mb-2 font-medium">API Status</h2>
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-muted-foreground text-sm">
              {healthCheck.isLoading
                ? "Checking..."
                : healthCheck.data
                  ? "Connected"
                  : "Disconnected"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
