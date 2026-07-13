import { describe, expect, it } from "vitest";
import { compactSchema, isComplex, signature, typeLabel, type JsonSchema } from "../src/schema-render.js";

const scalarSchema: JsonSchema = {
  type: "object",
  properties: {
    owner: { type: "string", description: "Repository owner" },
    count: { type: "number", description: "How many" },
    force: { type: "boolean", description: "Force it" },
    tags: { type: "array", items: { type: "string" }, description: "Labels" },
  },
  required: ["owner", "count"],
};

describe("typeLabel", () => {
  it("maps scalars, arrays, unions, and unknowns", () => {
    expect(typeLabel({ type: "string" })).toBe("string");
    expect(typeLabel({ type: "array", items: { type: "number" } })).toBe("number[]");
    expect(typeLabel({ type: "array" })).toBe("any[]");
    expect(typeLabel({ type: ["string", "null"] })).toBe("string|null");
    expect(typeLabel({})).toBe("any");
  });
});

describe("signature", () => {
  it("marks required with ! and optional with ?", () => {
    expect(signature("create", scalarSchema)).toBe(
      "create(owner: string!, count: number!, force?: boolean, tags?: string[])",
    );
  });

  it("renders a no-param tool as name()", () => {
    expect(signature("ping", { type: "object" })).toBe("ping()");
    expect(signature("ping")).toBe("ping()");
  });
});

describe("isComplex", () => {
  it("flags enums, unions, nested objects, and arrays of objects", () => {
    expect(isComplex({ type: "string", enum: ["a", "b"] })).toBe(true);
    expect(isComplex({ oneOf: [{ type: "string" }] })).toBe(true);
    expect(isComplex({ type: "object", properties: { x: { type: "string" } } })).toBe(true);
    expect(isComplex({ type: "array", items: { type: "object", properties: { x: {} } } })).toBe(true);
  });

  it("does not flag plain scalars or free-form objects/arrays", () => {
    expect(isComplex({ type: "string" })).toBe(false);
    expect(isComplex({ type: "object" })).toBe(false);
    expect(isComplex({ type: "array", items: { type: "string" } })).toBe(false);
  });
});

describe("compactSchema", () => {
  it("renders signature, description, and an aligned param table", () => {
    const out = compactSchema("create", "Create a thing", scalarSchema);
    expect(out).toContain("create(owner: string!, count: number!, force?: boolean, tags?: string[])");
    expect(out).toContain("Create a thing");
    expect(out).toContain("owner!");
    expect(out).toContain("Repository owner");
    // optional params have no trailing !
    expect(out).toMatch(/\n\s+force\s+boolean\s+Force it/);
  });

  it("appends raw JSON for complex params instead of dropping them", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["fast", "slow"], description: "Speed" },
        payload: { type: "object", properties: { id: { type: "string" } } },
      },
      required: ["mode"],
    };
    const out = compactSchema("run", undefined, schema);
    expect(out).toContain("Complex params (full schema):");
    expect(out).toContain('"enum":["fast","slow"]');
    expect(out).toContain('"properties":{"id":{"type":"string"}}');
    // required complex params keep their ! marker in the raw-JSON section
    expect(out).toContain("mode!:");
    // complex params still appear in the signature with their base type
    expect(out).toContain("run(mode: string!, payload?: object)");
  });

  it("handles a no-param tool", () => {
    expect(compactSchema("ping", "Ping the server", { type: "object" })).toBe(
      "ping()\n\nPing the server",
    );
  });
});
