import * as React from "react";
import { cn } from "@/lib/utils";

export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "size"> {
  value: number;
  onChange: (value: number) => void;
  size?: "default" | "sm";
}

function formatRupiah(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, className, size = "default", ...props }, ref) => {
    const [display, setDisplay] = React.useState(() => formatRupiah(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setDisplay(formatRupiah(value));
    }, [value, focused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^\d]/g, "");
      const num = raw === "" ? 0 : Number(raw);
      setDisplay(raw === "" ? "" : formatRupiah(num));
      onChange(num);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      setDisplay(value > 0 ? String(value) : "");
      e.target.select();
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      setDisplay(formatRupiah(value));
      props.onBlur?.(e);
    };

    return (
      <div className="relative">
        <span className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground font-semibold",
          size === "sm" ? "left-1.5 text-[10px]" : "left-2.5 text-xs"
        )}>
          Rp
        </span>
        <input
          ref={ref}
          type={focused ? "number" : "text"}
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            "w-full rounded-lg border border-border bg-muted/30 outline-none focus:border-primary text-right tabular-nums",
            size === "sm"
              ? "pl-6 pr-2 py-2 text-xs"
              : "pl-9 pr-3 py-2.5 text-xs rounded-xl",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
CurrencyInput.displayName = "CurrencyInput";
