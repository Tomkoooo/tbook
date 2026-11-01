/**
 * Pure product/variant logic shared by the console, the point of sale and
 * the inventory API.
 */

export interface VariantOptionDef {
  name: string;
  values: string[];
}

/** Every combination of option values, in option order: [{Size:"S",Color:"Black"}, …]. */
export function variantCombinations(options: VariantOptionDef[]): Array<Record<string, string>> {
  return options.reduce<Array<Record<string, string>>>(
    (combos, option) => combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value }))),
    [{}],
  );
}

/** "M · Black" in option order; "" for a single-variant product. */
export function variantLabel(variantOptions: Record<string, string>, optionOrder: VariantOptionDef[] = []): string {
  const ordered = optionOrder.map((option) => variantOptions[option.name]).filter((value): value is string => Boolean(value));
  const rest = Object.entries(variantOptions)
    .filter(([name]) => !optionOrder.some((option) => option.name === name))
    .map(([, value]) => value);
  return [...ordered, ...rest].join(" · ");
}

/** Stable key for an option combination, independent of key order. */
export function optionKey(options: Record<string, string>): string {
  return Object.keys(options)
    .sort()
    .map((name) => `${name}=${options[name]}`)
    .join("|");
}

/** A variant's own price, else the product's. */
export function resolveVariantPrice(productPriceGross: number, variantPriceGross: number | null | undefined): number {
  return variantPriceGross ?? productPriceGross;
}

/** Suggested SKU for a combination: BASE-M-BLACK (accents stripped, uppercase). */
export function suggestSku(base: string, options: Record<string, string>): string {
  const clean = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase();
  return [clean(base), ...Object.values(options).map(clean)].filter(Boolean).join("-").slice(0, 64) || "SKU";
}

export interface ProductVariantDraft {
  sku: string;
  options: Record<string, string>;
}

/**
 * Checks a product's variants against its option definitions. Returns a
 * list of human-readable problems (empty when valid).
 */
export function validateProductVariants(options: VariantOptionDef[], variants: ProductVariantDraft[]): string[] {
  const problems: string[] = [];
  const optionNames = options.map((option) => option.name);
  if (new Set(optionNames.map((n) => n.toLowerCase())).size !== optionNames.length) problems.push("Option names must be unique.");
  for (const option of options) {
    if (new Set(option.values.map((v) => v.toLowerCase())).size !== option.values.length) {
      problems.push(`Option "${option.name}" lists the same value twice.`);
    }
  }
  if (options.length === 0 && variants.length > 1) problems.push("A product without options (like size) has exactly one variant.");

  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const variant of variants) {
    const sku = variant.sku.trim().toUpperCase();
    if (skus.has(sku)) problems.push(`SKU ${variant.sku} is used twice.`);
    skus.add(sku);

    const names = Object.keys(variant.options);
    if (names.length !== optionNames.length || !optionNames.every((name) => name in variant.options)) {
      problems.push(`Variant ${variant.sku} must set exactly: ${optionNames.join(", ") || "no options"}.`);
      continue;
    }
    for (const option of options) {
      if (!option.values.includes(variant.options[option.name]!)) {
        problems.push(`Variant ${variant.sku}: "${variant.options[option.name]}" is not a ${option.name} value.`);
      }
    }
    const key = optionKey(variant.options);
    if (options.length > 0 && combos.has(key)) problems.push(`Two variants have the same options (${variantLabel(variant.options, options)}).`);
    combos.add(key);
  }
  return problems;
}
