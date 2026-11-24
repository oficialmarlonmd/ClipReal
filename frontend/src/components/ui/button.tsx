import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "subtle" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type = "button", ...props }, ref) => {
    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      default:
        "bg-zinc-900 text-zinc-200 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 hover:text-zinc-50",
      primary:
        "bg-zinc-50 text-zinc-950 border border-zinc-50 font-medium hover:bg-zinc-200 hover:border-zinc-200",
      subtle:
        "bg-zinc-800/70 text-zinc-100 border border-zinc-700/80 hover:bg-zinc-800 hover:border-zinc-600",
      ghost:
        "bg-transparent text-zinc-400 border border-transparent hover:bg-zinc-800/70 hover:text-zinc-100",
      danger:
        "bg-rose-600 text-white border border-rose-600 font-medium hover:bg-rose-500",
    };

    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      xs: "h-7 px-2 text-[11.5px] rounded-md gap-1.5",
      sm: "h-7.5 px-2.5 text-xs rounded-md gap-1.5",
      md: "h-8.5 px-3.5 text-[13px] rounded-lg gap-2",
      icon: "h-7 w-7 p-0 rounded-md",
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
          "disabled:pointer-events-none disabled:opacity-40",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
