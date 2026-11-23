import type { StatusTone } from "./status-tones";

/**
 * Colours for registration answers. A choice question gets one tone per
 * choice, by its position in the question's choice list, so "MÁV" is the same
 * colour on every guest, in every table and in the breakdown; the palette
 * skips the red (danger) and green (success) that mean "problem" and "done"
 * elsewhere. An answer that says there is no room, or that it is on a
 * waiting list, is the exception: it is always the warning tone.
 */
const CHOICE_PALETTE: StatusTone[] = ["info", "note", "neutral"];

const NO_ROOM = /nincs szabad|megtelt|várólista|waiting ?list|sold out|\bfull\b/i;

export function choiceTone(index: number, label: string): StatusTone {
  if (NO_ROOM.test(label)) return "warning";
  if (index < 0) return "neutral";
  return CHOICE_PALETTE[index % CHOICE_PALETTE.length]!;
}
