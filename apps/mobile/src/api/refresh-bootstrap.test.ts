import { describe, expect, it, vi } from "vitest";
import { refreshBootstrap } from "./refresh-bootstrap";

describe("refreshBootstrap", () => {
  it("joins a fetch already in flight instead of cancelling and restarting it", () => {
    const client = { invalidateQueries: vi.fn(() => Promise.resolve()) };
    refreshBootstrap(client);
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["bootstrap"] }, { cancelRefetch: false });
  });
});
