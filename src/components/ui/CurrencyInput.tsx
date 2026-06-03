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
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const cursorRef = React.useRef<number | null>(null);

    const [display, setDisplay] = React.useState(() => formatRupiah(value));

    // Sync display when value changes externally (e.g. reset form)
    const lastValueRef = React.useRef(value);
    React.useEffect(() => {
      if (value !== lastValueRef.current) {
        lastValueRef.current = value;
        setDisplay(formatRupiah(value));
      }
    }, [value]);

    // Restore cursor position after React re-renders the formatted value
    React.useLayoutEffect(() => {
      if (cursorRef.current !== null && innerRef.current) {
        innerRef.current.setSelectionRange(cursorRef.current, cursorRef.current);
        cursorRef.current = null;
      }
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const caretBefore = el.selectionStart ?? 0;
      const oldVal = el.value;

      // Count how many digit chars are to the LEFT of the caret in the old value
      const digitsBeforeCaret = oldVal.slice(0, caretBefore).replace(/[^\d]/g, "").length;

      const raw = oldVal.replace(/[^\d]/g, "");
      const num = raw === "" ? 0 : Number(raw);
      const formatted = formatRupiah(num);

      // Find the caret position in the new formatted string so that the same
      // number of digits are to its left
      let newCaret = 0;
      let counted = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (counted >= digitsBeforeCaret) break;
        if (/\d/.test(formatted[i])) counted++;
        newCaret = i + 1;
      }

      cursorRef.current = newCaret;
      lastValueRef.current = num;
      setDisplay(formatted);
      onChange(num);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      // Keep formatted display — user sees "25.000.000" while typing
      setTimeout(() => e.target.select(), 0);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setDisplay(formatRupiah(value));
      props.onBlur?.(e);
    };

    const setRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      },
      [ref]
    );

    return (
      <div className="relative">
        <span className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground font-semibold",
          size === "sm" ? "left-1.5 text-[10px]" : "left-2.5 text-xs"
        )}>
          Rp
        </span>
        <input
          ref={setRef}
          type="text"
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
