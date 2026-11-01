import { parseInput } from "@tbook/actions";
import { extractApiKeyFromRequest, resolveInventoryApiKey } from "@tbook/services";
import type { z } from "zod";
import { readJsonBody } from "./response";

/**
 * Inventory API (docs/inventory-api.md): authenticated with the
 * organization's inventory key in `X-TBook-Api-Key` (or `Authorization:
 * Bearer`). Server-to-server only — the key must never reach a browser.
 */
export async function requireInventoryOrg(request: Request): Promise<string> {
  const { organizationId } = await resolveInventoryApiKey(extractApiKeyFromRequest(request));
  return organizationId;
}

export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  return parseInput(schema, await readJsonBody(request));
}

/** Product image paths (/media/…) as absolute URLs, so the webshop can use them directly. */
export function withAbsoluteImages<T extends { images: string[] }>(product: T, request: Request): T {
  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return { ...product, images: product.images.map((image) => (image.startsWith("/") ? `${base}${image}` : image)) };
}

/** The inverse for input: our own absolute image URLs go back to stored /media/… paths. */
export function withRelativeImages<T extends { images: string[] }>(input: T, request: Request): T {
  const bases = [process.env.NEXT_PUBLIC_APP_URL, new URL(request.url).origin].filter(Boolean).map((b) => b!.replace(/\/+$/, ""));
  return {
    ...input,
    images: input.images.map((image) => {
      const base = bases.find((b) => image.startsWith(`${b}/media/`));
      return base ? image.slice(base.length) : image;
    }),
  };
}
