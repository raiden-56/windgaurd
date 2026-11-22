"use client";

export function OfflineActions() {
  return (
    <div className="mt-6 flex flex-col gap-2">
      <a href="/attendance" className="inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-5 text-sm font-semibold text-white">
        Open attendance register
      </a>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex h-11 items-center justify-center rounded-md border border-white/20 px-5 text-sm font-semibold text-white/85">
        Try again
      </button>
    </div>
  );
}
