import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import AsciiMotionAnimation from '../components/ascii-motion-animation';

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());

  return (
    <div className="container mx-auto max-w-6xl px-4 py-2">
      <div className="grid gap-6">
       
      <div className="max-w-6xl mx-auto mt-[-100px]">
      <AsciiMotionAnimation
        showControls={false}
        autoPlay={false}
      />
      </div>
       <section className="max-w-3xl mx-auto w-full rounded-lg border p-4">
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
