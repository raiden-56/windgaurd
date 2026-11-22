"use client";

import { Suspense } from "react";
import { BrandMark } from "@/components/shell/brand";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/lib/session";

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-navy">
      <div className="flex flex-col items-center gap-4">
        <BrandMark className="size-12" />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-[wg-fade-in_0.8s_ease-in-out_infinite_alternate] rounded-full bg-[#14B8A6]" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<Splash />}>
      <AppShell>
        <Suspense fallback={null}>{children}</Suspense>
      </AppShell>
    </SessionProvider>
  );
}
