import type { IBooking, IEvent } from "@tbook/db";
import type { AttendeeFieldDef, BookingAttendee } from "@tbook/schemas";
import type { ResolvedModules } from "./module-registry";

/**
 * Extension points core exposes to feature modules. Core never imports a
 * module: a module registers handlers here (from @tbook/modules) and core
 * calls whatever is registered. Each handler decides for itself whether
 * its module is on for the event, via the `modules` it is given.
 *
 * State lives on globalThis so every bundle Next produces (route handlers,
 * server actions, instrumentation) shares one registry even if this file
 * is evaluated more than once.
 */

export interface EventContext {
  event: IEvent;
  organizationId: string | null;
  groupId: string | null;
  modules: ResolvedModules;
}

/** One selectable answer a module supplies for a `choicesSource` select. */
export interface DynamicChoice {
  value: string;
  label: string;
  /** Places left, when the choice is limited (shown to the guest, enforced on reserve). */
  remaining?: number | null;
  /** Shown but not selectable (e.g. full). */
  disabled?: boolean;
  /** Extra details for the storefront (address, time, contact), all display-only. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ChoiceProvider {
  /** Referenced from a field's `choicesSource`, e.g. "bus-transport:routes". */
  key: string;
  /** Owning module; the provider yields nothing when that module is off. */
  moduleKey: string;
  /** Shown in the form builder's "choices come from" picker. */
  label: string;
  list(ctx: EventContext): Promise<DynamicChoice[]>;
}

/**
 * Reserves whatever a module limits (bus seats, …) for a new booking, after
 * field and rule validation passed. Throw an ActionError to refuse; the
 * returned release() undoes the reservation if a later step fails.
 */
export type RegistrationReserver = (
  ctx: EventContext & {
    bookingId: string;
    attendees: BookingAttendee[];
    fieldSchema: AttendeeFieldDef[];
    /** Check only (preview mode): refuse exactly as a real reservation would, but change nothing. */
    dryRun?: boolean;
  },
) => Promise<{ release: () => Promise<void> } | null>;

/**
 * A module that holds identifying answers outside bookings (e.g. a
 * waitlist entry holding an employee ID). Asked before `unique` values
 * are claimed and by the ID-first prefill: return the first held value,
 * with a guest-facing message, or null.
 */
export interface HeldIdentifier {
  fieldKey: string;
  value: string;
  /** Machine-readable reason, e.g. "waitlist". */
  reason: string;
  /** Guest-facing (the event's language). */
  message: string;
}
export type IdentifierHolder = (ctx: EventContext, values: Array<{ fieldKey: string; value: string }>) => Promise<HeldIdentifier | null>;

/** A booking stopped holding its place (cancelled or expired). */
/**
 * Something a booking held is given back. `booking.attendees` lists exactly
 * the attendees being released: all of them on cancel/expiry, one on a
 * per-guest cancellation, the previous version of the list on an edit
 * (the edit then reserves for the new list).
 */
export type BookingReleaseReason = "cancelled" | "expired" | "attendee_cancelled" | "edited";
export type BookingReleasedHook = (booking: IBooking, reason: BookingReleaseReason) => Promise<void>;

/** A booking was confirmed and its vouchers exist (paid, comped, or free registration). */
export type BookingConfirmedHook = (booking: IBooking) => Promise<void>;

/** Return true when a module sends its own confirmation and the default booking email should be skipped. */
export type BookingEmailSuppressor = (booking: IBooking) => Promise<boolean>;

/** Return true when this booking needs no payment step (it is confirmed directly). */
export type CheckoutBypass = (booking: IBooking, ctx: EventContext) => Promise<boolean>;

/**
 * Placeholders a module adds to attendee emails (e.g. `{{bus.city}}`).
 * `values` returns the filled values for one attendee of a booking.
 */
export interface AttendeePlaceholderProvider {
  moduleKey: string;
  placeholders: Array<{ key: string; label: string; sample: string }>;
  values(ctx: EventContext, booking: IBooking, attendeeIndex: number): Promise<Record<string, string>>;
}

interface ExtensionState {
  choiceProviders: Map<string, ChoiceProvider>;
  registrationReservers: Map<string, RegistrationReserver>;
  bookingReleased: Map<string, BookingReleasedHook>;
  bookingConfirmed: Map<string, BookingConfirmedHook>;
  bookingEmailSuppressors: Map<string, BookingEmailSuppressor>;
  checkoutBypasses: Map<string, CheckoutBypass>;
  attendeePlaceholders: Map<string, AttendeePlaceholderProvider>;
  identifierHolders: Map<string, IdentifierHolder>;
}

const STATE_KEY = Symbol.for("tbook.extensions");

function state(): ExtensionState {
  const holder = globalThis as unknown as Record<symbol, ExtensionState | undefined>;
  if (!holder[STATE_KEY]) {
    holder[STATE_KEY] = {
      choiceProviders: new Map(),
      registrationReservers: new Map(),
      bookingReleased: new Map(),
      bookingConfirmed: new Map(),
      bookingEmailSuppressors: new Map(),
      checkoutBypasses: new Map(),
      attendeePlaceholders: new Map(),
      identifierHolders: new Map(),
    };
  }
  // A registry created by an older bundle may lack newer maps.
  holder[STATE_KEY]!.identifierHolders ??= new Map();
  return holder[STATE_KEY]!;
}

// Registration is keyed (by module key or provider key), so registering
// twice — a module file evaluated in two bundles — replaces, never duplicates.

export const extensions = {
  registerChoiceProvider(provider: ChoiceProvider): void {
    state().choiceProviders.set(provider.key, provider);
  },
  registerRegistrationReserver(key: string, reserver: RegistrationReserver): void {
    state().registrationReservers.set(key, reserver);
  },
  onBookingReleased(key: string, hook: BookingReleasedHook): void {
    state().bookingReleased.set(key, hook);
  },
  onBookingConfirmed(key: string, hook: BookingConfirmedHook): void {
    state().bookingConfirmed.set(key, hook);
  },
  registerBookingEmailSuppressor(key: string, suppressor: BookingEmailSuppressor): void {
    state().bookingEmailSuppressors.set(key, suppressor);
  },
  registerCheckoutBypass(key: string, bypass: CheckoutBypass): void {
    state().checkoutBypasses.set(key, bypass);
  },
  registerAttendeePlaceholders(provider: AttendeePlaceholderProvider): void {
    state().attendeePlaceholders.set(provider.moduleKey, provider);
  },
  registerIdentifierHolder(key: string, holder: IdentifierHolder): void {
    state().identifierHolders.set(key, holder);
  },
  identifierHolders(): IdentifierHolder[] {
    return [...state().identifierHolders.values()];
  },
  attendeePlaceholderProviders(): AttendeePlaceholderProvider[] {
    return [...state().attendeePlaceholders.values()];
  },

  choiceProvider(key: string): ChoiceProvider | undefined {
    return state().choiceProviders.get(key);
  },
  choiceProviders(): ChoiceProvider[] {
    return [...state().choiceProviders.values()];
  },
  registrationReservers(): RegistrationReserver[] {
    return [...state().registrationReservers.values()];
  },
  bookingReleasedHooks(): BookingReleasedHook[] {
    return [...state().bookingReleased.values()];
  },
  bookingConfirmedHooks(): BookingConfirmedHook[] {
    return [...state().bookingConfirmed.values()];
  },
  bookingEmailSuppressors(): BookingEmailSuppressor[] {
    return [...state().bookingEmailSuppressors.values()];
  },
  checkoutBypasses(): CheckoutBypass[] {
    return [...state().checkoutBypasses.values()];
  },
};
