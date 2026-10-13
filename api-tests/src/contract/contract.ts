/**
 * Contract conformance: every response the API client receives is checked against contract/openapi.yaml.
 *
 * - The response status must be documented for the operation (2xx/3xx always; 4xx/5xx gaps are reported as a
 *   `contract-gap` annotation, or fail when CONTRACT_STRICT_STATUS=1).
 * - The Content-Type must be one the operation documents for that status.
 * - The JSON body must validate against the documented schema (JSON Schema 2020-12, which OpenAPI 3.1 uses).
 * - Response headers the contract documents (Location, ETag, Deprecation, ...) must be present.
 * - Object schemas are "closed": a field the contract does not declare is a violation, so both implementations
 *   return exactly the same shape (Problem stays open because RFC 9457 allows extension members).
 * - Nullable fields (`type: [x, 'null']`) must be present, as `null` when empty, never omitted
 *   (docs/SPEC.md "Decisions" 5). Applied to response schemas only.
 */
import fs from 'node:fs';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import { config } from '../config';

const CONTRACT_ID = 'https://library.example/contract/openapi.json';
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/** docs/SPEC.md "Time": UTC, millisecond precision, `Z` suffix. Stricter than RFC 3339 on purpose. */
const STRICT_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Json = Record<string, unknown>;

interface Operation {
  method: string;
  template: string;
  regex: RegExp;
  pointer: string;
  node: Json;
}

export interface ResponseUnderTest {
  method: string;
  /** Path without query string, e.g. /api/v1/books/123 */
  path: string;
  status: number;
  headers: Record<string, string>;
  contentType: string | undefined;
  body: unknown;
  rawText: string;
}

export interface ContractReport {
  operation?: string;
  violations: string[];
  gaps: string[];
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isObject(x: unknown): x is Json {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Rewrites local `$ref: '#/...'` into absolute refs so any sub-schema can be compiled on its own. */
function absolutiseRefs(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(absolutiseRefs);
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) node[key] = CONTRACT_ID + value;
    else absolutiseRefs(value);
  }
}

/** Adds `additionalProperties: false` to every object schema that lists properties and says nothing itself. */
function closeObjectSchemas(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(closeObjectSchemas);
  if (!isObject(node)) return;
  const type = node.type;
  const isObjectSchema = type === 'object' || (Array.isArray(type) && type.includes('object'));
  if (isObjectSchema && isObject(node.properties) && node.additionalProperties === undefined) {
    node.additionalProperties = false;
  }
  for (const value of Object.values(node)) closeObjectSchemas(value);
}

function isNullable(schema: unknown): boolean {
  if (!isObject(schema)) return false;
  const t = schema.type;
  if (t === 'null' || (Array.isArray(t) && t.includes('null'))) return true;
  return [schema.oneOf, schema.anyOf].some((list) => Array.isArray(list) && list.some((s) => isObject(s) && s.type === 'null'));
}

/** SPEC Decisions 5: every nullable property of an object schema is listed in `required`. */
function requireNullableProperties(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(requireNullableProperties);
  if (!isObject(node)) return;
  if (isObject(node.properties)) {
    const nullable = Object.entries(node.properties).filter(([, prop]) => isNullable(prop)).map(([name]) => name);
    if (nullable.length) node.required = [...new Set([...((node.required as string[] | undefined) ?? []), ...nullable])];
  }
  for (const value of Object.values(node)) requireNullableProperties(value);
}

/** Request-only schemas (BookCreate, BookUpdate, ...) are never used to validate responses. */
const REQUEST_SCHEMA = /(Create|Update|Request)$/;

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => {
      const where = e.instancePath || '(root)';
      const extra = e.keyword === 'additionalProperties' ? ` "${String(e.params.additionalProperty)}"` : '';
      return `${where} ${e.message ?? e.keyword}${extra}`;
    })
    .join('; ');
}

export class Contract {
  readonly document: Json;
  private readonly ajv: Ajv2020;
  private readonly operations: Operation[];
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(source: string, options: { closed: boolean }) {
    const doc = YAML.parse(source) as Json;
    absolutiseRefs(doc);
    const componentSchemas = (doc.components as Json).schemas as Json;
    for (const [name, schema] of Object.entries(componentSchemas)) if (!REQUEST_SCHEMA.test(name)) requireNullableProperties(schema);
    requireNullableProperties(doc.paths);
    if (options.closed) {
      const components = doc.components as Json;
      const schemas = components.schemas as Json;
      const { Problem, ...rest } = schemas;
      closeObjectSchemas(rest);
      closeObjectSchemas(doc.paths);
      void Problem; // RFC 9457 allows extension members, so Problem stays open
    }
    this.document = doc;

    this.ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
    addFormats(this.ajv, { formats: ['uuid', 'email', 'uri', 'uri-reference'] });
    this.ajv.addFormat('date-time', {
      type: 'string',
      validate: (s: string) => STRICT_DATE_TIME.test(s) && !Number.isNaN(Date.parse(s)),
    });
    this.ajv.addSchema(doc, CONTRACT_ID);

    const paths = doc.paths as Record<string, Json>;
    this.operations = Object.entries(paths)
      .flatMap(([template, item]) =>
        METHODS.filter((m) => isObject(item[m])).map((method) => ({
          method: method.toUpperCase(),
          template,
          regex: new RegExp(
            '^' + template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '$',
          ),
          pointer: `#/paths/${escapePointer(template)}/${method}`,
          node: item[method] as Json,
        })),
      )
      // literal segments win over parameters: /members/me before /members/{memberId}
      .sort((a, b) => (a.template.match(/\{/g)?.length ?? 0) - (b.template.match(/\{/g)?.length ?? 0));
  }

  static load(): Contract {
    return new Contract(fs.readFileSync(config.contractPath, 'utf8'), { closed: !config.allowExtraFields });
  }

  findOperation(method: string, path: string): Operation | undefined {
    return this.operations.find((op) => op.method === method.toUpperCase() && op.regex.test(path));
  }

  /** True if the contract lists `status` (or its NXX range / default) for the operation behind method + path. */
  isDocumented(method: string, path: string, status: number): boolean {
    const op = this.findOperation(method, path);
    const responses = (op?.node.responses ?? {}) as Json;
    return [String(status), `${String(status)[0]}XX`, 'default'].some((k) => k in responses);
  }

  /** Validates `value` against the schema of a named component, e.g. `Problem` or `Book`. */
  validateComponent(name: string, value: unknown): string | undefined {
    return this.validateAt(`#/components/schemas/${name}`, value);
  }

  private resolve(ref: string): Json {
    const pointer = ref.startsWith(CONTRACT_ID) ? ref.slice(CONTRACT_ID.length) : ref;
    let node: unknown = this.document;
    for (const raw of pointer.replace(/^#\//, '').split('/')) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      node = isObject(node) ? node[key] : undefined;
    }
    if (!isObject(node)) throw new Error(`Contract reference not found: ${ref}`);
    return node;
  }

  private validateAt(pointer: string, value: unknown): string | undefined {
    let validate = this.compiled.get(pointer);
    if (!validate) {
      // JSON pointer segments may contain `{`, `}` or `+`, so they are URI-encoded inside the fragment
      const fragment = '#/' + pointer.replace(/^#\//, '').split('/').map(encodeURIComponent).join('/');
      validate = this.ajv.compile({ $ref: CONTRACT_ID + fragment });
      this.compiled.set(pointer, validate);
    }
    return validate(value) ? undefined : formatAjvErrors(validate.errors);
  }

  check(res: ResponseUnderTest): ContractReport {
    const report: ContractReport = { violations: [], gaps: [] };
    const op = this.findOperation(res.method, res.path);
    const mediaType = res.contentType?.split(';')[0]?.trim().toLowerCase();
    const hasBody = res.rawText.length > 0;

    if (!op) {
      // Not a contract route (unknown path, /docs, /openapi.yaml). Errors must still be problem documents.
      if (res.status >= 400) this.checkProblemFallback(res, mediaType, report);
      return report;
    }
    report.operation = `${op.method} ${op.template}`;

    const responses = op.node.responses as Json;
    const key = [String(res.status), `${String(res.status)[0]}XX`, 'default'].find((k) => k in responses);
    if (!key) {
      const msg = `${report.operation} returned ${res.status}, which the contract does not document`;
      if (res.status < 400 || config.strictStatusCodes) report.violations.push(msg);
      else report.gaps.push(msg);
      if (res.status >= 400) this.checkProblemFallback(res, mediaType, report);
      return report;
    }

    let responsePointer = `${op.pointer}/responses/${key}`;
    let response = responses[key] as Json;
    if (typeof response.$ref === 'string') {
      responsePointer = response.$ref.slice(CONTRACT_ID.length);
      response = this.resolve(response.$ref);
    }

    // documented headers must be there (the contract lists them without `required`, we treat them as promised)
    for (const header of Object.keys((response.headers as Json | undefined) ?? {})) {
      if (res.headers[header.toLowerCase()] === undefined) {
        report.violations.push(`${report.operation} ${res.status}: missing documented header "${header}"`);
      }
    }

    const content = response.content as Json | undefined;
    if (!content) {
      if (hasBody) report.violations.push(`${report.operation} ${res.status}: body must be empty, got "${res.rawText.slice(0, 120)}"`);
      return report;
    }
    if (!mediaType || !(mediaType in content)) {
      report.violations.push(
        `${report.operation} ${res.status}: Content-Type "${res.contentType ?? '(none)'}" is not one of ${Object.keys(content).join(', ')}`,
      );
      return report;
    }
    const schemaPointer = `${responsePointer}/content/${escapePointer(mediaType)}/schema`;
    const body = mediaType.includes('json') ? res.body : res.rawText;
    const error = this.validateAt(schemaPointer, body);
    if (error) report.violations.push(`${report.operation} ${res.status} body does not match the contract: ${error}`);
    return report;
  }

  private checkProblemFallback(res: ResponseUnderTest, mediaType: string | undefined, report: ContractReport): void {
    if (mediaType !== 'application/problem+json') {
      report.violations.push(`${res.method} ${res.path} ${res.status}: errors must be application/problem+json, got "${res.contentType ?? '(none)'}"`);
      return;
    }
    const error = this.validateComponent('Problem', res.body);
    if (error) report.violations.push(`${res.method} ${res.path} ${res.status}: not a valid Problem: ${error}`);
  }
}

let shared: Contract | undefined;
/** One parsed contract per worker process. */
export function contract(): Contract {
  shared ??= Contract.load();
  return shared;
}
