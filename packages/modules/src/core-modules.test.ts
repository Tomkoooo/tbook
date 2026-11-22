import { describe, expect, it } from "vitest";
import { getModuleDefinition, listModuleDefinitions, resolveModulesFromDocs } from "@tbook/services";
import "./index";
import { HOTELS, POINT_OF_SALE, TICKET_SALES } from "./index";
// @ts-expect-error — plain-JS migration script, deliberately not part of the TS build.
import { CORE_MODULE_KEYS } from "../../../scripts/migrate/enable-core-modules.mjs";

const granted = { modules: { [POINT_OF_SALE]: { enabled: true }, [HOTELS]: { enabled: true }, [TICKET_SALES]: { enabled: true } } };

describe("core modules (point of sale, hotels, ticket selling)", () => {
  it("are registered with the keys and scopes the console relies on", () => {
    expect(POINT_OF_SALE).toBe("point-of-sale");
    expect(HOTELS).toBe("hotels");
    expect(TICKET_SALES).toBe("ticket-sales");
    expect(getModuleDefinition(POINT_OF_SALE)?.scopes).toEqual(["org", "event"]);
    expect(getModuleDefinition(HOTELS)?.scopes).toEqual(["org", "group", "event"]);
    expect(getModuleDefinition(TICKET_SALES)?.scopes).toEqual(["org", "event"]);
    for (const key of [POINT_OF_SALE, HOTELS, TICKET_SALES]) expect(getModuleDefinition(key)?.defaultOn).toBe(true);
  });

  it("show up in the registry list the organizations admin page renders", () => {
    const keys = listModuleDefinitions().map((definition) => definition.key);
    expect(keys).toEqual(expect.arrayContaining([POINT_OF_SALE, HOTELS, TICKET_SALES]));
  });

  it("match the keys the migration grants to existing organizations", () => {
    expect([...CORE_MODULE_KEYS].sort()).toEqual([HOTELS, POINT_OF_SALE, TICKET_SALES].sort());
  });

  it("are off for a new organization until a system admin grants them", () => {
    const resolved = resolveModulesFromDocs({ modules: {} }, null, null);
    for (const key of [POINT_OF_SALE, HOTELS, TICKET_SALES]) expect(resolved.isOn(key)).toBe(false);
  });

  it("are on for every event of a granted organization (existing orgs keep working)", () => {
    const resolved = resolveModulesFromDocs(granted, null, { modules: {} });
    for (const key of [POINT_OF_SALE, HOTELS, TICKET_SALES]) expect(resolved.isOn(key)).toBe(true);
  });

  it("can be switched off for one event, and hotels for one group", () => {
    const off = { modules: { [POINT_OF_SALE]: { enabled: false } } };
    expect(resolveModulesFromDocs(granted, null, off).isOn(POINT_OF_SALE)).toBe(false);
    expect(resolveModulesFromDocs(granted, null, off).isOn(TICKET_SALES)).toBe(true);

    const groupOff = { modules: { [HOTELS]: { enabled: false } } };
    expect(resolveModulesFromDocs(granted, groupOff, null).isOn(HOTELS)).toBe(false);
    // an event with no entry of its own inherits the group's switch
    expect(resolveModulesFromDocs(granted, groupOff, { modules: {} }).isOn(HOTELS)).toBe(false);
  });

  it("are not offered where they cannot be switched: nothing can override the org entitlement", () => {
    const eventOn = { modules: { [POINT_OF_SALE]: { enabled: true } } };
    expect(resolveModulesFromDocs({ modules: {} }, null, eventOn).isOn(POINT_OF_SALE)).toBe(false);
  });
});
