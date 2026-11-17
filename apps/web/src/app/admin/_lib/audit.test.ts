import { describe, expect, it } from "vitest";
import { auditSentence } from "./audit";

describe("auditSentence", () => {
  it("names the program actions in plain words", () => {
    expect(auditSentence("program.earning_auto_released")).toBe("Released a held program earning automatically");
    expect(auditSentence("program.withdrawal.approve")).toBe("Approved a program withdrawal");
  });
});
