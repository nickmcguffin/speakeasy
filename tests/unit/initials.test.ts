import { expect, test } from "vitest";
import { initials } from "../../client/ParticipantPanel";

test("two words give the first letter of each, in capitals", () => {
  expect(initials("ada lovelace")).toBe("AL");
  expect(initials("  Grace   Brewster Hopper ")).toBe("GB");
});

test("one word gives one letter", () => {
  expect(initials("bob")).toBe("B");
});

test("a name that starts with an emoji keeps the whole emoji", () => {
  expect(initials("🦊 fox")).toBe("🦊F");
});
