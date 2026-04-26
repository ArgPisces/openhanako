function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve the request-side thinking control format declared by a model.
 *
 * Precedence:
 *   1. Explicit model.compat.thinkingFormat
 *   2. Protocol quirks projected from known-models.json
 *   3. Legacy/runtime derivation for pre-existing models.json entries
 */
export function getThinkingFormat(model, context = {}) {
  if (!isPlainObject(model)) return null;

  const explicit = lower(model.compat?.thinkingFormat);
  if (explicit) return explicit;

  const quirks = Array.isArray(model.quirks) ? model.quirks : [];
  if (quirks.includes("enable_thinking")) return "qwen";

  const api = lower(model.api || context.api);
  const provider = lower(model.provider || context.provider);

  // New models.json entries should carry compat.thinkingFormat. This branch keeps
  // already-projected runtime model objects working until the next provider sync.
  if (model.reasoning === true && api === "anthropic-messages") {
    return "anthropic";
  }

  // Built-in Anthropic models may arrive without Hana's projected compat object.
  if (provider === "anthropic" && model.reasoning !== false) {
    return "anthropic";
  }

  return null;
}

export function withThinkingFormatCompat(model, context = {}) {
  if (!isPlainObject(model)) return model;

  const format = getThinkingFormat(model, context);
  if (!format) return model;

  const compat = isPlainObject(model.compat) ? model.compat : {};
  if (lower(compat.thinkingFormat) === format) return model;

  return {
    ...model,
    compat: {
      ...compat,
      thinkingFormat: format,
    },
  };
}
