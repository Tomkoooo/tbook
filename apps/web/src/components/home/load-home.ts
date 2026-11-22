import "@/lib/register-modules";
import { organizationRepository } from "@tbook/db";
import { listEventsForOrg, listOrganizationsForUser, resolveMembershipPermissions, resolveModules } from "@tbook/services";
import { TBOOK_OWNER_PERMISSIONS } from "@tbook/schemas";
import type { SessionUser } from "@/lib/admin-auth";
import { buildEventShortcuts, buildOrgLinks, needsOrgChoice, pickHomeEvents, soleOrganizationToSelect, type EventShortcut, type HomeEventsMode } from "@/lib/home-data";
import { NAV_GROUPS, type NavItem } from "@/lib/nav-config";
import { getActiveOrganizationIdFromCookie } from "@/lib/org-cookie";

export interface HomeOrgOption {
  id: string;
  name: string;
  slug: string;
}

export interface HomeEventView {
  id: string;
  name: string;
  groupId: string | null;
  startDate: Date;
  endDate: Date;
  address: string;
  shortcuts: EventShortcut[];
}

export type HomeState =
  /** Not a member of any organization (and not a platform admin). */
  | { kind: "no-orgs" }
  /** Several memberships and none active: show the picker. */
  | { kind: "choose-org"; organizations: HomeOrgOption[] }
  /** Exactly one membership and none active: select it through /auth/pick-org. */
  | { kind: "auto-select"; organization: HomeOrgOption }
  /** Platform admin without an active organization. */
  | { kind: "system-no-org" }
  | {
      kind: "ready";
      organizationName: string;
      canSwitchOrg: boolean;
      isSystemAdmin: boolean;
      permissions: string[];
      mode: HomeEventsMode;
      events: HomeEventView[];
      eventsFailed: boolean;
      orgLinks: NavItem[];
    };

/** Max events that get a module lookup each: a safety cap, a day rarely has more than a handful. */
const MAX_EVENTS = 8;

/**
 * What the active organization and this member's access look like, resolved
 * without redirects or throws (mirrors the admin layout: a stale or foreign
 * org cookie simply counts as "no active organization", and nothing about
 * another organization is read).
 */
async function resolveActiveOrg(user: SessionUser, organizationId: string | null) {
  if (!organizationId) return null;
  try {
    const org = await organizationRepository.findById(organizationId);
    if (!org || org.status === "suspended") return null;
    if (user.isSystemAdmin) return { org, permissions: [...TBOOK_OWNER_PERMISSIONS] as string[] };
    const membership = await resolveMembershipPermissions(organizationId, user.id);
    return membership ? { org, permissions: [...membership.permissions] as string[] } : null;
  } catch (error) {
    console.error("[home] resolving the active organization failed", error);
    return null;
  }
}

export async function loadHome(user: SessionUser): Promise<HomeState> {
  const cookieOrgId = user.activeOrganizationId ?? (await getActiveOrganizationIdFromCookie());
  const active = await resolveActiveOrg(user, cookieOrgId);

  let organizations: HomeOrgOption[] = [];
  if (!user.isSystemAdmin) {
    try {
      organizations = await listOrganizationsForUser(user.id);
    } catch (error) {
      console.error("[home] listing organizations failed", error);
    }
  }

  if (!active) {
    if (user.isSystemAdmin) return { kind: "system-no-org" };
    const sole = soleOrganizationToSelect({ organizations, hasValidActiveOrg: false, isSystemAdmin: false });
    if (sole) return { kind: "auto-select", organization: sole };
    if (needsOrgChoice({ organizationCount: organizations.length, hasValidActiveOrg: false, isSystemAdmin: false })) return { kind: "choose-org", organizations };
    return { kind: "no-orgs" };
  }

  const organizationId = String(active.org._id);
  const orgModules = Object.entries((active.org.modules ?? {}) as Record<string, { enabled?: boolean }>)
    .filter(([, state]) => state?.enabled)
    .map(([key]) => key);

  let mode: HomeEventsMode = "none";
  let events: HomeEventView[] = [];
  let eventsFailed = false;
  try {
    const all = await listEventsForOrg(organizationId);
    const picked = pickHomeEvents(
      all.map((event) => ({ doc: event, id: String(event._id), name: event.name, status: event.status, startDate: event.startDate, endDate: event.endDate, groupId: event.groupId ? String(event.groupId) : null, location: event.location })),
      new Date(),
    );
    mode = picked.mode;
    events = await Promise.all(
      picked.events.slice(0, MAX_EVENTS).map(async (entry) => {
        const modules = await resolveModules({ organizationId, event: entry.doc });
        return {
          id: entry.id,
          name: entry.name,
          groupId: entry.groupId,
          startDate: entry.startDate,
          endDate: entry.endDate,
          address: entry.location?.address ?? "",
          shortcuts: buildEventShortcuts({ permissions: active.permissions, isOn: modules.isOn, hasVipList: Boolean(entry.doc.vipListId) }, { eventId: entry.id, groupId: entry.groupId }),
        };
      }),
    );
  } catch (error) {
    console.error("[home] loading events failed", error);
    eventsFailed = true;
    mode = "none";
    events = [];
  }

  return {
    kind: "ready",
    organizationName: active.org.name,
    canSwitchOrg: user.isSystemAdmin || organizations.length > 1,
    isSystemAdmin: user.isSystemAdmin,
    permissions: active.permissions,
    mode,
    events,
    eventsFailed,
    orgLinks: buildOrgLinks(NAV_GROUPS, { permissions: active.permissions, modules: orgModules }),
  };
}
