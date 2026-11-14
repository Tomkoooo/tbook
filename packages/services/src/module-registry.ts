import { ActionError } from "@tbook/actions";
import { eventGroupRepository, eventRepository, organizationRepository, type IEvent, type IEventGroup, type IOrganization } from "@tbook/db";
import type { ModuleScope, ModuleState, ModulesMap } from "@tbook/schemas";

/**
 * Feature modules: code shipped with tBook (registered from @tbook/modules),
 * switched on per organization by a system admin (the entitlement), and per
 * event group / event inside that entitlement.
 *
 *   effective(event) = org.enabled && (event entry ?? group entry ?? defaultOn)
 *   config(event)    = org config ← group config ← event config (shallow merge)
 */

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  /** Where it can be switched on. "org" alone = an org-wide feature with no per-event switch. */
  scopes: readonly ModuleScope[];
  /** Whether it is on for every group/event of an entitled org until switched off there. */
  defaultOn?: boolean;
  /** Other modules that must be on wherever this one is. */
  dependsOn?: readonly string[];
  /** Settings an organizer can fill in where the module is on (rendered generically by the console). */
  configFields?: readonly ModuleConfigField[];
}

export interface ModuleConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "select";
  hint?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /**
   * Kept only so existing settings keep working; the console hides the
   * field while it is empty and shows this note when it is set (e.g. "Use
   * the Emails page").
   */
  deprecated?: string;
}

const REGISTRY_KEY = Symbol.for("tbook.modules");

function registry(): Map<string, ModuleDefinition> {
  const holder = globalThis as unknown as Record<symbol, Map<string, ModuleDefinition> | undefined>;
  if (!holder[REGISTRY_KEY]) holder[REGISTRY_KEY] = new Map();
  return holder[REGISTRY_KEY]!;
}

export function registerModule(definition: ModuleDefinition): void {
  registry().set(definition.key, definition);
}

export function listModuleDefinitions(): ModuleDefinition[] {
  return [...registry().values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getModuleDefinition(key: string): ModuleDefinition | undefined {
  return registry().get(key);
}

export interface ResolvedModules {
  isOn(key: string): boolean;
  config<T extends object = Record<string, unknown>>(key: string): T;
  /** Keys of every module on at this scope. */
  enabledKeys(): string[];
}

function readMap(doc: { modules?: unknown } | null | undefined): ModulesMap {
  const raw = doc?.modules;
  return raw && typeof raw === "object" ? (raw as ModulesMap) : {};
}

/** Pure resolution over already-loaded documents. Exported for tests. */
export function resolveModulesFromDocs(
  org: Pick<IOrganization, "modules"> | null,
  group: Pick<IEventGroup, "modules"> | null,
  event: Pick<IEvent, "modules"> | null,
): ResolvedModules {
  const orgMap = readMap(org);
  const groupMap = readMap(group);
  const eventMap = readMap(event);

  const on = (key: string): boolean => {
    const definition = getModuleDefinition(key);
    if (!definition || !orgMap[key]?.enabled) return false;
    // An org-only module, or a question asked without an event/group, is just the entitlement.
    if (!group && !event) return true;
    if (!definition.scopes.includes("event") && !definition.scopes.includes("group")) return true;
    const local = eventMap[key] ?? groupMap[key];
    if (local) return local.enabled;
    return definition.defaultOn ?? false;
  };

  return {
    isOn: on,
    config<T extends object>(key: string): T {
      return { ...(orgMap[key]?.config ?? {}), ...(groupMap[key]?.config ?? {}), ...(eventMap[key]?.config ?? {}) } as T;
    },
    enabledKeys() {
      return listModuleDefinitions()
        .map((definition) => definition.key)
        .filter(on);
    },
  };
}

/** Loads the org / group / event and resolves which modules are on there. */
export async function resolveModules(scope: {
  organizationId?: string | null;
  groupId?: string | null;
  eventId?: string | null;
  event?: IEvent | null;
}): Promise<ResolvedModules> {
  const event = scope.event ?? (scope.eventId ? await eventRepository.findById(scope.eventId) : null);
  const groupId = scope.groupId ?? (event?.groupId ? String(event.groupId) : null);
  const group = groupId ? await eventGroupRepository.findById(groupId) : null;
  const organizationId = scope.organizationId ?? (group?.organizationId ? String(group.organizationId) : event?.organizationId ? String(event.organizationId) : null);
  const org = organizationId ? await organizationRepository.findById(organizationId) : null;
  return resolveModulesFromDocs(org, group, event);
}

function nextState(previous: ModuleState | undefined, patch: { enabled?: boolean; config?: Record<string, unknown> }, userId: string | null): ModuleState {
  return {
    enabled: patch.enabled ?? previous?.enabled ?? false,
    config: patch.config ?? previous?.config ?? {},
    changedBy: userId,
    changedAt: new Date(),
  };
}

function assertKnownModule(key: string, scope: ModuleScope): ModuleDefinition {
  const definition = getModuleDefinition(key);
  if (!definition) throw ActionError.validation(`Unknown module "${key}".`);
  if (!definition.scopes.includes(scope)) throw ActionError.validation(`${definition.name} can't be set on a ${scope}.`);
  return definition;
}

/** System-admin action: grant or withdraw a module for an organization. */
export async function setOrganizationModule(
  organizationId: string,
  key: string,
  patch: { enabled?: boolean; config?: Record<string, unknown> },
  userId: string | null,
): Promise<void> {
  assertKnownModule(key, "org");
  const org = await organizationRepository.findById(organizationId);
  if (!org) throw ActionError.notFound("Organization not found");
  const map = readMap(org);
  await organizationRepository.updateById(organizationId, { [`modules.${key}`]: nextState(map[key], patch, userId) } as never);
}

/** Org-member action (module:manage): switch a module on/off for an event, inside the entitlement. */
export async function setEventModule(
  organizationId: string,
  eventId: string,
  key: string,
  patch: { enabled?: boolean; config?: Record<string, unknown> },
  userId: string | null,
): Promise<void> {
  const definition = assertKnownModule(key, "event");
  const org = await organizationRepository.findById(organizationId);
  if (!readMap(org)[key]?.enabled) throw ActionError.forbidden(`${definition.name} isn't enabled for this organization. Ask a system admin.`);
  const event = await eventRepository.findById(eventId);
  if (!event) throw ActionError.notFound("Event not found");
  const map = readMap(event);
  if (patch.enabled) {
    const resolved = await resolveModules({ organizationId, event });
    for (const dependency of definition.dependsOn ?? []) {
      if (!resolved.isOn(dependency)) {
        throw ActionError.validation(`${definition.name} needs ${getModuleDefinition(dependency)?.name ?? dependency} switched on first.`);
      }
    }
  }
  await eventRepository.updateById(eventId, { [`modules.${key}`]: nextState(map[key], patch, userId) } as never);
}

/** Keeps only the declared config fields of a module, as trimmed strings. */
export function cleanModuleConfig(key: string, raw: Record<string, unknown>): Record<string, string> {
  const definition = getModuleDefinition(key);
  const out: Record<string, string> = {};
  for (const field of definition?.configFields ?? []) {
    const given = raw[field.key];
    // A yes/no select also takes a JSON boolean (e.g. from a setup plan).
    const yesNo = typeof given === "boolean" && field.type === "select" && field.options?.some((o) => o.value === "yes") && field.options?.some((o) => o.value === "no");
    const value = (yesNo ? (given ? "yes" : "no") : String(given ?? "")).trim().slice(0, 500);
    if (field.type === "url" && value && !/^https?:\/\//i.test(value)) throw ActionError.validation(`${field.label} must start with https://`);
    if (field.type === "select" && value && !field.options?.some((option) => option.value === value)) throw ActionError.validation(`Choose a valid ${field.label}.`);
    out[field.key] = value;
  }
  return out;
}
