import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { ERROR_CODES } from '../../src/domain/shared/domain-error';
import * as S from '../../src/interface/http/validation/schemas';

/**
 * The Zod request schemas are written by hand; this test keeps them honest against contract/openapi.yaml.
 * (Their TypeScript shapes are already compared with the generated types at compile time, see schemas.ts.)
 */
type JsonSchema = Record<string, any>;

const contract = parse(readFileSync(resolve(__dirname, '../../../contract/openapi.yaml'), 'utf8'));
const schemas: Record<string, JsonSchema> = contract.components.schemas;

const REQUEST_SCHEMAS: Record<string, z.ZodType> = {
  TokenRequest: S.TokenRequest,
  AuthorCreate: S.AuthorCreate,
  BookCreate: S.BookCreate,
  BookUpdate: S.BookUpdate,
  CopyCreate: S.CopyCreate,
  MemberCreate: S.MemberCreate,
  MemberStatusUpdate: S.MemberStatusUpdate,
  LoanCreate: S.LoanCreate,
  ReservationCreate: S.ReservationCreate,
};

const CONSTRAINTS = ['minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems', 'enum'] as const;

function deref(schema: JsonSchema): JsonSchema {
  return schema['$ref'] ? schemas[String(schema['$ref']).split('/').pop()!]! : schema;
}

/** The non-null branch of `anyOf: [X, {type: null}]` (how Zod writes nullable). */
function nonNull(schema: JsonSchema): JsonSchema {
  const branch = (schema['anyOf'] as JsonSchema[] | undefined)?.find((s) => s['type'] !== 'null');
  return branch ?? schema;
}

function compareProperty(name: string, expected: JsonSchema, actual: JsonSchema): void {
  const want = deref(expected);
  const got = nonNull(actual);
  for (const key of CONSTRAINTS) {
    if (want[key] !== undefined) expect(got[key], `${name}.${key}`).toEqual(want[key]);
  }
  if (Array.isArray(want['type']) && want['type'].includes('null')) {
    expect(actual['anyOf'], `${name} must be nullable`).toBeDefined();
  }
  if (want['items']) compareProperty(`${name}[]`, want['items'], got['items']);
}

describe('request schemas match contract/openapi.yaml', () => {
  for (const [name, zodSchema] of Object.entries(REQUEST_SCHEMAS)) {
    it(name, () => {
      const expected = schemas[name]!;
      const actual = z.toJSONSchema(zodSchema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
      expect(actual['additionalProperties'], 'additionalProperties').toBe(false);
      expect(expected['additionalProperties']).toBe(false);
      expect(Object.keys(actual['properties']).sort()).toEqual(Object.keys(expected['properties']).sort());
      expect([...(actual['required'] ?? [])].sort()).toEqual([...(expected['required'] ?? [])].sort());
      for (const [property, schema] of Object.entries<JsonSchema>(expected['properties'])) {
        compareProperty(`${name}.${property}`, schema, actual['properties'][property]);
      }
    });
  }

  it('the problem codes are exactly the contract enum', () => {
    expect([...ERROR_CODES].sort()).toEqual([...schemas['Problem']!['properties'].code.enum].sort());
  });
});
