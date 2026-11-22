"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white shadow-sm hover:bg-primary-hover",
        secondary: "bg-navy text-white hover:bg-slate dark:bg-slate dark:hover:bg-navy-2",
        outline: "border border-line-strong bg-surface text-fg hover:border-subtle hover:bg-surface-2",
        ghost: "text-muted hover:bg-sunken hover:text-fg",
        subtle: "bg-sunken text-fg hover:bg-line",
        danger: "bg-danger text-white hover:brightness-110",
        "danger-outline": "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
        accent: "bg-accent text-white hover:brightness-110",
        link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        xs: "h-7 px-2 text-xs",
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5 text-sm",
        lg: "h-11 px-5 text-[15px]",
        xl: "h-14 px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <Loader2 className="animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";


/** A navigation link styled as a button. */
export function LinkButton({ href, className, variant, size, children, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </Link>
  );
}
