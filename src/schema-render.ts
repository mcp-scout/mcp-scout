// Token-efficient renderings of a downstream tool's JSON Schema.
//
// Raw JSON Schema is verbose — repeated "type"/"properties"/"description" keys,
// braces, and quoting dominate the token count. These renderers collapse the
// common case (flat scalar params) into a signature line + aligned param table,
// while never silently dropping fidelity: any "complex" param (enum, nested
// object, union, array-of-objects) has its raw JSON sub-schema appended verbatim.

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  description?: string;
  [k: string]: unknown;
};

/** Short type label, e.g. "string", "number[]", "a|b". Unknown/missing → "any". */
export function typeLabel(prop: JsonSchema): string {
  if (Array.isArray(prop.type)) {
    return prop.type.length > 0 ? prop.type.join("|") : "any";
  }
  if (prop.type === "array") {
    return `${prop.items ? typeLabel(prop.items) : "any"}[]`;
  }
  return typeof prop.type === "string" ? prop.type : "any";
}

/**
 * A param is "complex" when a one-word type label loses information the caller
 * needs: enums, unions (oneOf/anyOf/allOf), nested objects, or arrays whose
 * items are themselves complex. These get their raw JSON schema appended.
 */
export function isComplex(prop: JsonSchema): boolean {
  if (Array.isArray(prop.enum)) return true;
  if (prop.oneOf || prop.anyOf || prop.allOf) return true;
  if (prop.properties) return true;
  if (prop.type === "array" && prop.items && isComplex(prop.items)) return true;
  return false;
}

function entriesOf(schema?: JsonSchema): Array<[string, JsonSchema]> {
  return schema?.properties ? Object.entries(schema.properties) : [];
}

/**
 * One-line call signature, e.g.
 *   update_dashboard(dashboard: object!, folderUid?: string, message?: string)
 * Required params are `name: type!`; optional params are `name?: type`.
 * A tool with no params renders as `name()`.
 */
export function signature(name: string, schema?: JsonSchema): string {
  const required = new Set(schema?.required ?? []);
  const parts = entriesOf(schema).map(([pname, prop]) =>
    required.has(pname) ? `${pname}: ${typeLabel(prop)}!` : `${pname}?: ${typeLabel(prop)}`,
  );
  return `${name}(${parts.join(", ")})`;
}

/**
 * Full compact rendering: signature line, optional description, an aligned
 * param table, and raw JSON for any complex params.
 */
export function compactSchema(
  name: string,
  description: string | undefined,
  schema?: JsonSchema,
): string {
  const lines: string[] = [signature(name, schema)];

  const desc = description?.replace(/\s+/g, " ").trim();
  if (desc) {
    lines.push("", desc);
  }

  const required = new Set(schema?.required ?? []);
  const entries = entriesOf(schema);
  // Simple (scalar/scalar-array) params go in the aligned table. Complex params
  // (enum/union/nested object/array-of-objects) go in the raw-JSON section only,
  // so their descriptions are never duplicated — keeping compact <= full.
  const simple = entries.filter(([, prop]) => !isComplex(prop));
  const complex = entries.filter(([, prop]) => isComplex(prop));

  if (simple.length > 0) {
    const rows = simple.map(([pname, prop]) => ({
      nameCol: required.has(pname) ? `${pname}!` : pname,
      typeCol: typeLabel(prop),
      desc: (prop.description ?? "").replace(/\s+/g, " ").trim(),
    }));
    const nameW = Math.max(...rows.map((r) => r.nameCol.length));
    const typeW = Math.max(...rows.map((r) => r.typeCol.length));
    lines.push("");
    for (const r of rows) {
      lines.push(`  ${r.nameCol.padEnd(nameW)}  ${r.typeCol.padEnd(typeW)}  ${r.desc}`.trimEnd());
    }
  }

  if (complex.length > 0) {
    lines.push("", "Complex params (full schema):");
    for (const [pname, prop] of complex) {
      lines.push(`  ${pname}${required.has(pname) ? "!" : ""}: ${JSON.stringify(prop)}`);
    }
  }

  return lines.join("\n");
}
