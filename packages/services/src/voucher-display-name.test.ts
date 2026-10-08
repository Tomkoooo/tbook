import { describe, expect, it } from "vitest";
import type { AttendeeFieldDef } from "@tbook/schemas";
import { resolveAttendeeDisplayName } from "./voucher-service";

function field(key: string, label: string, type: AttendeeFieldDef["type"] = "text"): AttendeeFieldDef {
  return { key, label, type, required: true, helpText: "", sortOrder: 0 };
}

/** Mirrors the real Hungarian Open Pairs roster schema. */
const MEMBER_SCHEMA = [
  field("teljes_nev", "Teljes név"),
  field("e_mail", "E-mail", "email"),
  field("allampolgarsag", "Állampolgárság"),
];

const PERSON_SCHEMA = [field("full_name", "Teljes név"), field("email", "E-mail", "email")];

describe("resolveAttendeeDisplayName", () => {
  describe("individual entries", () => {
    it("uses the attendee's own name field", () => {
      const name = resolveAttendeeDisplayName(
        0,
        [{ fields: { full_name: "Kovács Béla", email: "b@example.com" } }],
        PERSON_SCHEMA,
        "Buyer Name",
        1,
      );
      expect(name).toBe("Kovács Béla");
    });

    it("falls back to the buyer for a single entry with no fields", () => {
      expect(resolveAttendeeDisplayName(0, [{ fields: {} }], PERSON_SCHEMA, "Buyer Name", 1)).toBe("Buyer Name");
    });

    it("numbers the fallback when there are several entries", () => {
      expect(resolveAttendeeDisplayName(1, [{ fields: {} }, { fields: {} }], PERSON_SCHEMA, "Buyer", 2)).toBe(
        "Buyer (2. vendég)",
      );
    });
  });

  describe("team entries", () => {
    // The real data shape: a pair ticket's own fields are empty and the
    // players live under `members`.
    const pair = [
      {
        fields: {},
        members: [
          { fields: { teljes_nev: "Mayu Shimizu", e_mail: "m@example.com", allampolgarsag: "JAPAN" } },
          { fields: { teljes_nev: "Yukie Sakaguchi", e_mail: "y@example.com", allampolgarsag: "JAPAN" } },
        ],
      },
    ];

    it("names a pair after both players", () => {
      // Before this, the ticket read just the buyer's name, which told the
      // door staff nothing about who was entitled to walk in.
      expect(resolveAttendeeDisplayName(0, pair, [], "Tsuyoshi Yamasaki", 1, MEMBER_SCHEMA)).toBe(
        "Mayu Shimizu & Yukie Sakaguchi",
      );
    });

    it("names a larger roster after its first player plus a count", () => {
      const team = [
        {
          fields: {},
          members: [
            { fields: { teljes_nev: "Benjamin Drue Reus" } },
            { fields: { teljes_nev: "Patrick Lykke Heinsøe" } },
            { fields: { teljes_nev: "Brian Rohmann Andersen" } },
            { fields: { teljes_nev: "Tonni Søndergaard" } },
            { fields: { teljes_nev: "Brian Søhus Andersen" } },
          ],
        },
      ];
      // The full list would overflow the ticket layout.
      expect(resolveAttendeeDisplayName(0, team, [], "Klaus Lundberg", 1, MEMBER_SCHEMA)).toBe("Benjamin Drue Reus +4");
    });

    it("names a one-player roster after that player", () => {
      const solo = [{ fields: {}, members: [{ fields: { teljes_nev: "Tóth Tamás" } }] }];
      expect(resolveAttendeeDisplayName(0, solo, [], "Tóth Tamás", 1, MEMBER_SCHEMA)).toBe("Tóth Tamás");
    });

    it("prefers the entry's own name field over the roster when both exist", () => {
      const withTeamName = [
        {
          fields: { team_name: "Team Rocket" },
          members: [{ fields: { teljes_nev: "A Player" } }, { fields: { teljes_nev: "B Player" } }],
        },
      ];
      expect(
        resolveAttendeeDisplayName(0, withTeamName, [field("team_name", "Csapat név")], "Buyer", 1, MEMBER_SCHEMA),
      ).toBe("Team Rocket");
    });

    it("keeps the old buyer-name behaviour when no member schema is supplied", () => {
      // Backward compatibility for any caller that doesn't pass the schema.
      expect(resolveAttendeeDisplayName(0, pair, [], "Tsuyoshi Yamasaki", 1)).toBe("Tsuyoshi Yamasaki");
    });

    it("falls back to the buyer when the roster has no readable names", () => {
      const blank = [{ fields: {}, members: [{ fields: {} }, { fields: {} }] }];
      expect(resolveAttendeeDisplayName(0, blank, [], "Buyer Name", 1, MEMBER_SCHEMA)).toBe("Buyer Name");
    });
  });
});
