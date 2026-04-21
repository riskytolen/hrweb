import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
  size?: "sm" | "md";
}

const variantStyles = {
  default: "bg-primary-light text-primary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  danger: "bg-danger-light text-danger",
  info: "bg-accent-light text-accent",
  muted: "bg-muted text-muted-foreground",
};

export default function Badge({
  children,
  variant = "default",
  size = "sm",
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-lg",
        variantStyles[variant],
        size === "sm" ? "text-[11px] px-2.5 py-1" : "text-xs px-3 py-1.5"
      )}
    >
      {children}
    </span>
  );
}
