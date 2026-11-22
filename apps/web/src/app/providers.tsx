"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ConfirmProvider, TooltipProvider } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );

  useEffect(() => {
    // Service worker: production builds only (dev chunks change on every edit).
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={250}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </TooltipProvider>
      <Toaster position="top-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
    </QueryClientProvider>
  );
}
