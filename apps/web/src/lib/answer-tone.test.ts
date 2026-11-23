import { describe, expect, it } from "vitest";
import { choiceTone } from "./answer-tone";

describe("choiceTone", () => {
  it("gives each choice a stable tone by position", () => {
    expect(choiceTone(0, "MÁV")).toBe("info");
    expect(choiceTone(1, "VKM")).toBe("note");
    expect(choiceTone(3, "DHEL")).toBe("info");
  });
  it("always warns on a no-room answer, whatever its position", () => {
    expect(choiceTone(0, "Nincs szabad hely – értesítést kérek, ha felszabadul")).toBe("warning");
  });
  it("is neutral for an answer that is not one of the choices", () => {
    expect(choiceTone(-1, "Egyéb")).toBe("neutral");
  });
});
