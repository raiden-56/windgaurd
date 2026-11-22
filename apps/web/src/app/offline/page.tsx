import type { Metadata } from "next";
import { BrandMark } from "@/components/shell/brand";
import { OfflineActions } from "./actions";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-navy px-6 text-white">
      <div className="max-w-sm text-center">
        <BrandMark className="mx-auto size-12" />
        <h1 className="mt-5 font-display text-2xl font-bold">You are offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          This page has not been saved on this device yet. Registers you opened earlier are still available — attendance you record is kept on the device and synchronized when the network returns.
        </p>
        <OfflineActions />
      </div>
    </main>
  );
}
