import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
}

const variantStyles = {
  primary:
    "bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/25",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline:
    "border border-border bg-card text-foreground hover:bg-muted hover:border-primary/30",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-sm shadow-danger/25",
};

const sizeStyles = {
  sm: "text-xs px-3 py-2 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2.5 rounded-xl gap-2",
  lg: "text-sm px-6 py-3 rounded-xl gap-2",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {Icon && iconPosition === "left" && (
        <Icon className={cn(size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      )}
      {children}
      {Icon && iconPosition === "right" && (
        <Icon className={cn(size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      )}
    </button>
  );
}
