import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MIN_MESSAGE,
  validatePasswordLength,
} from "../password-policy";

describe("password-policy", () => {
  it("menetapkan minimal 6 karakter (batas Supabase Auth)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(PASSWORD_MIN_MESSAGE).toBe("Password minimal 6 karakter.");
  });

  it("menolak password kosong dan bukan string", () => {
    expect(validatePasswordLength("")).toBe("Password wajib diisi.");
    expect(validatePasswordLength(undefined)).toBe("Password wajib diisi.");
    expect(validatePasswordLength(null)).toBe("Password wajib diisi.");
    expect(validatePasswordLength(123456)).toBe("Password wajib diisi.");
  });

  it("menolak password 5 karakter", () => {
    expect(validatePasswordLength("abcde")).toBe(
      "Password minimal 6 karakter."
    );
  });

  it("menerima password tepat 6 karakter", () => {
    expect(validatePasswordLength("abcdef")).toBeNull();
  });

  it("menerima password lebih dari 6 karakter", () => {
    expect(validatePasswordLength("abcdefg123")).toBeNull();
  });
});
