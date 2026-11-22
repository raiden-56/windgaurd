"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { ArrowLeft, Fingerprint, KeyRound, ShieldCheck, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BrandMark, Wordmark } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/shell/theme";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { useOnline } from "@/lib/connectivity";
import { cn } from "@/lib/utils";

const loginSchema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
const recoverSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    code: z.string().min(6, "Enter the code from your administrator"),
    newPassword: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

const SHIFTS = [
  { code: "S1", name: "First", from: 6, to: 14, color: "#0F9F8F" },
  { code: "S2", name: "Second", from: 14, to: 22, color: "#2A78D6" },
  { code: "S3", name: "Third", from: 22, to: 30, color: "#EB6834" },
];

/** A live 24-hour shift clock: the three-shift structure the platform is built around. */
function ShiftClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ist = now ? new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })) : null;
  const hour = ist ? ist.getHours() + ist.getMinutes() / 60 : 0;
  const pos = (((hour - 6 + 24) % 24) / 24) * 100; // timeline starts at 06:00
  const current = SHIFTS.find((s) => (hour >= s.from && hour < s.to) || (s.to > 24 && hour < s.to - 24)) ?? SHIFTS[0];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-white/45">Shift clock · IST</span>
        <span className="font-display text-2xl font-bold tabular text-white">{ist ? ist.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
      </div>
      <div className="relative mt-5">
        <div className="flex h-9 gap-[3px] overflow-hidden rounded-md">
          {SHIFTS.map((s) => (
            <div key={s.code} className={cn("flex items-center justify-between px-2.5 text-[11px] font-semibold text-white transition-opacity", current.code === s.code ? "opacity-100" : "opacity-45")} style={{ background: s.color, flex: s.to - s.from }}>
              <span>{s.code}</span>
              <span className="hidden font-normal text-white/80 xl:inline">{s.name}</span>
            </div>
          ))}
        </div>
        {ist && (
          <div className="absolute -top-1.5 bottom-[-6px] w-0.5 rounded bg-white shadow-[0_0_0_3px_rgba(17,28,45,0.8)]" style={{ left: `${pos}%` }} aria-hidden>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-white" />
          </div>
        )}
        <div className="mt-2 flex justify-between text-[10.5px] tabular text-white/40">
          <span>06:00</span>
          <span>14:00</span>
          <span>22:00</span>
          <span>06:00</span>
        </div>
      </div>
      <p className="mt-4 text-sm text-white/70">
        <span className="font-semibold text-white">{current.name} shift</span> in progress. Overnight shifts are recorded against the date they start, so a 22:00–06:00 checkout never lands on the wrong day.
      </p>
    </div>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";
  const online = useOnline();
  const [mode, setMode] = useState<"main" | "recover">("main");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webauthn, setWebauthn] = useState(true);
  useEffect(() => setWebauthn(browserSupportsWebAuthn()), []);

  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const recover = useForm<z.infer<typeof recoverSchema>>({ resolver: zodResolver(recoverSchema), defaultValues: { email: "", code: "", newPassword: "", confirm: "" } });

  const done = () => {
    router.replace(next);
    router.refresh();
  };

  const passkey = async () => {
    setError(null);
    setPasskeyBusy(true);
    try {
      const optionsJSON = await api("/auth/passkey/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON });
      await api("/auth/passkey/login/verify", { body: { response } });
      done();
    } catch (err: any) {
      if (err?.name === "NotAllowedError") setError("Passkey sign-in was cancelled or timed out.");
      else setError(errorMessage(err));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const onPassword = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api("/auth/login", { body: v });
      done();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const onRecover = recover.handleSubmit(async ({ confirm: _c, ...v }) => {
    setError(null);
    try {
      await api("/auth/recover", { body: v });
      router.replace("/settings?tab=security&setup=passkey");
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col">
        <svg className="pointer-events-none absolute -right-24 -top-24 size-[520px] text-white/[0.035]" viewBox="0 0 200 200" aria-hidden>
          <g stroke="currentColor" strokeWidth="6" strokeLinecap="round" fill="none">
            <path d="M100 100V20" />
            <path d="M100 100l69 40" />
            <path d="M100 100l-69 40" />
          </g>
          <circle cx="100" cy="100" r="9" fill="currentColor" />
        </svg>
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <Wordmark light className="text-lg" />
        </div>
        <div className="mt-auto max-w-lg">
          <p className="text-sm font-medium text-[#5EEAD4]">Workforce attendance for wind-energy sites</p>
          <h1 className="mt-3 font-display text-[40px] font-extrabold leading-[1.08] tracking-tight">
            Every Shift.
            <br />
            Every Worker.
            <br />
            <span className="text-white/55">Accounted For.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/65">
            Supervisors record IN and OUT times for guards at the gate, substation and turbine clusters — online or off. Admins see every site, every register and every correction, with a complete audit trail.
          </p>
          <div className="mt-8">
            <ShiftClock />
          </div>
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/50">
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Biometrics never leave your device
          </li>
          <li className="flex items-center gap-1.5">
            <WifiOff className="size-3.5" /> Works without network at remote sites
          </li>
        </ul>
      </section>

      {/* Sign-in */}
      <section className="relative flex flex-col bg-bg px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible">
            <BrandMark />
            <Wordmark />
          </div>
          <ThemeToggle />
        </div>
        <div className="mx-auto my-auto w-full max-w-[400px] py-10">
          <AnimatePresence mode="wait" initial={false}>
            {mode === "main" ? (
              <motion.div key="main" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                <h2 className="font-display text-2xl font-bold tracking-tight">Sign in</h2>
                <p className="mt-1.5 text-sm text-muted">For administrators and site supervisors. Workers do not need an account.</p>

                {!online && (
                  <div className="mt-5 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-[13px] text-warning">
                    <WifiOff className="mt-0.5 size-4 shrink-0" />
                    You are offline. If you signed in on this device before, open the app from your home screen to continue marking attendance offline.
                  </div>
                )}

                <Button size="xl" className="mt-6 w-full" onClick={passkey} loading={passkeyBusy} disabled={!webauthn || !online}>
                  {!passkeyBusy && <Fingerprint className="!size-5" />}
                  Sign in with passkey
                </Button>
                <p className="mt-2 text-center text-xs text-muted">
                  {webauthn ? "Fingerprint, Face ID, Windows Hello or a security key." : "This browser does not support passkeys — use your password below."}
                </p>

                <div className="my-6 flex items-center gap-3 text-xs text-subtle">
                  <span className="h-px flex-1 bg-line" />
                  or use your password
                  <span className="h-px flex-1 bg-line" />
                </div>

                <form onSubmit={onPassword} className="flex flex-col gap-4" noValidate>
                  <Field label="Work email" error={form.formState.errors.email?.message} htmlFor="email">
                    <Input id="email" type="email" autoComplete="username webauthn" inputMode="email" placeholder="name@company.com" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
                  </Field>
                  <Field label="Password" error={form.formState.errors.password?.message} htmlFor="password">
                    <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register("password")} />
                  </Field>
                  {error && (
                    <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger" role="alert">
                      {error}
                    </p>
                  )}
                  <Button type="submit" variant="secondary" size="lg" loading={form.formState.isSubmitting} disabled={!online}>
                    Sign in
                  </Button>
                </form>
                <button type="button" onClick={() => (setMode("recover"), setError(null))} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary-ink hover:underline">
                  <KeyRound className="size-3.5" /> Lost your device? Use a recovery code
                </button>

                <details className="group mt-8 rounded-lg border border-line bg-surface p-3 text-[13px]">
                  <summary className="cursor-pointer list-none font-medium text-muted marker:hidden">
                    <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Demo accounts (sample data)
                  </summary>
                  <div className="mt-2 space-y-1 text-muted">
                    <p>
                      Password for all: <code className="rounded bg-sunken px-1.5 py-0.5 text-fg">Windguard@2026</code>
                    </p>
                    {[
                      ["admin@windguard.local", "Company Admin"],
                      ["supervisor@windguard.local", "Supervisor · Nakhatrana"],
                      ["superadmin@windguard.local", "Super Admin"],
                      ["auditor@windguard.local", "Viewer / Auditor"],
                    ].map(([e, r]) => (
                      <button key={e} type="button" className="flex w-full justify-between rounded px-1.5 py-1 text-left hover:bg-sunken" onClick={() => form.reset({ email: e, password: "Windguard@2026" })}>
                        <span className="text-fg">{e}</span>
                        <span className="text-xs">{r}</span>
                      </button>
                    ))}
                  </div>
                </details>
              </motion.div>
            ) : (
              <motion.div key="recover" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                <button type="button" onClick={() => (setMode("main"), setError(null))} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
                  <ArrowLeft className="size-4" /> Back to sign in
                </button>
                <h2 className="font-display text-2xl font-bold tracking-tight">Recover access</h2>
                <p className="mt-1.5 text-sm text-muted">Ask your company administrator for a one-time recovery code. After signing in, register a passkey on your new device.</p>
                <form onSubmit={onRecover} className="mt-6 flex flex-col gap-4" noValidate>
                  <Field label="Work email" error={recover.formState.errors.email?.message}>
                    <Input type="email" autoComplete="username" {...recover.register("email")} />
                  </Field>
                  <Field label="Recovery code" error={recover.formState.errors.code?.message}>
                    <Input autoComplete="one-time-code" className="font-mono uppercase tracking-[0.2em]" {...recover.register("code")} />
                  </Field>
                  <Field label="New password" error={recover.formState.errors.newPassword?.message}>
                    <Input type="password" autoComplete="new-password" {...recover.register("newPassword")} />
                  </Field>
                  <Field label="Confirm password" error={recover.formState.errors.confirm?.message}>
                    <Input type="password" autoComplete="new-password" {...recover.register("confirm")} />
                  </Field>
                  {error && (
                    <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger" role="alert">
                      {error}
                    </p>
                  )}
                  <Button type="submit" size="lg" loading={recover.formState.isSubmitting}>
                    Set password & sign in
                  </Button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <p className="text-center text-xs text-subtle">WINDGUARD · Every Shift. Every Worker. Accounted For.</p>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
