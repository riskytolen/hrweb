import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase-admin";
import { POST } from "@/app/api/tms/webhooks/mceasy/route";

const createAdminClientMock = vi.mocked(createAdminClient);

function request(body: unknown) {
  return new Request("http://localhost/api/tms/webhooks/mceasy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/tms/webhooks/mceasy", () => {
  it("stores a valid temperature payload and returns the inserted count", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    createAdminClientMock.mockReturnValue({ from: () => ({ insert }) } as never);

    const response = await POST(
      request({
        license_plate: "B 9402 BCU",
        imei: "864567234",
        driver: "ASEP SURAHMAN",
        latitude: -6.37,
        longitude: 106.74,
        temperature_num: 1,
        temperature: 4.5,
        engine_on: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      license_plate: "B 9402 BCU",
      temperature: 4.5,
      temperature_num: 1,
    });
    expect(await response.json()).toMatchObject({ ok: true, inserted: 1 });
  });

  it("rejects payloads without valid temperature data with 400", async () => {
    const response = await POST(request({ license_plate: "B 9402 BCU" }));
    expect(response.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400", async () => {
    const response = await POST(request("bukan-json"));
    expect(response.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db down" } });
    createAdminClientMock.mockReturnValue({ from: () => ({ insert }) } as never);

    const response = await POST(request({ license_plate: "B 9402 BCU", temperature: 4.5 }));
    expect(response.status).toBe(500);
  });
});
