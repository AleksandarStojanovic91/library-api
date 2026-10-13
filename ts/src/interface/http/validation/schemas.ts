import { z } from 'zod';
import { isValidIsbn13 } from '../../../domain/catalog/isbn';
import { LOAN_STATUSES } from '../../../domain/lending/loan';
import type { components } from '../../../generated/openapi';
import { ZodPipe } from './zod.pipe';

type Schemas = components['schemas'];

/**
 * Runtime request validation, mirroring contract/openapi.yaml. Two guards keep them in sync:
 * the type assertions at the bottom (shapes must equal the generated contract types, checked by tsc) and
 * test/unit/contract-consistency.test.ts (min/max/pattern/required/additionalProperties vs the YAML).
 */

const uuid = () => z.guid({ error: 'Must be a UUID' });
const allUnique = (items: readonly unknown[]) => new Set(items).size === items.length;
const UNIQUE = { error: 'Items must be unique' };

const isbn = z
  .string()
  .regex(/^97[89][0-9]{10}$/, { error: 'Must be 13 digits starting with 978 or 979', abort: true })
  .refine(isValidIsbn13, { error: 'Invalid ISBN-13 check digit' });

const authorIds = z.array(uuid()).min(1).max(20).refine(allUnique, UNIQUE);
const tags = z.array(z.string().min(1).max(50)).max(20).refine(allUnique, UNIQUE);

export const TokenRequest = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const AuthorCreate = z.strictObject({
  name: z.string().min(1).max(200),
  bio: z.string().max(2000).optional(),
});

export const BookCreate = z.strictObject({
  isbn,
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  publishedYear: z.int().min(1450).max(2100).optional(),
  authorIds,
  tags: tags.optional(),
});

/** JSON merge patch: absent = unchanged, null = clear (only where the field is nullable). */
export const BookUpdate = z
  .strictObject({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    publishedYear: z.int().min(1450).max(2100).nullable().optional(),
    authorIds: authorIds.optional(),
    tags: tags.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: 'At least one property is required' });

export const CopyCreate = z.strictObject({
  barcode: z.string().regex(/^[A-Z0-9-]{4,32}$/, { error: 'Must be 4-32 characters A-Z, 0-9 or -' }),
});

export const MemberCreate = z.strictObject({
  email: z.email().max(254),
  name: z.string().min(1).max(200),
  // bcrypt only hashes the first 72 bytes; anything longer would silently be truncated (SPEC Decisions 25).
  password: z
    .string()
    .min(10)
    .max(72, { abort: true })
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, { error: 'Must be at most 72 bytes (UTF-8)' }),
  maxActiveLoans: z.int().min(1).max(10).default(3),
});

export const MemberStatusUpdate = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  maxActiveLoans: z.int().min(1).max(10).optional(),
});

export const LoanCreate = z.strictObject({
  bookId: uuid(),
  memberId: uuid().optional(),
});

export const ReservationCreate = z.strictObject({
  bookId: uuid(),
});

// ---- query parameters -------------------------------------------------------------------------------------

const limit = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) {
      return 20;
    }
    const parsed = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
    if (!(parsed >= 1 && parsed <= 100)) {
      ctx.addIssue({ code: 'custom', message: 'Must be an integer from 1 to 100' });
      return z.NEVER;
    }
    return parsed;
  });

const booleanParam = z.enum(['true', 'false'], { error: 'Must be true or false' }).transform((value) => value === 'true');

const PageQuery = z.object({
  limit,
  cursor: z.string().max(500).optional(),
});

export const BookListQuery = PageQuery.extend({
  q: z.string().max(200).optional(),
  authorId: uuid().optional(),
  tag: z.string().max(50).optional(),
  available: booleanParam.optional(),
  sort: z.enum(['title', '-publishedYear']).default('title'),
});

export const SimplePageQuery = PageQuery;

export const LoanListQuery = PageQuery.extend({
  memberId: uuid().optional(),
  status: z.enum(LOAN_STATUSES).optional(),
});

export const ReservationListQuery = PageQuery.extend({
  memberId: uuid().optional(),
  bookId: uuid().optional(),
});

export const IdempotencyKey = z.string({ error: 'Required header' }).min(8).max(100);

/** Path parameter pipe: a malformed id is a 400 on that parameter, not a 404. */
export const uuidParam = (name: string) => new ZodPipe(uuid(), name);

// ---- compile-time drift check against the generated contract types --------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const CONTRACT_SHAPES_MATCH: [
  Same<z.input<typeof TokenRequest>, Schemas['TokenRequest']>,
  Same<z.input<typeof AuthorCreate>, Schemas['AuthorCreate']>,
  Same<z.input<typeof BookCreate>, Schemas['BookCreate']>,
  Same<z.input<typeof BookUpdate>, Schemas['BookUpdate']>,
  Same<z.input<typeof CopyCreate>, Schemas['CopyCreate']>,
  Same<z.input<typeof MemberCreate>, Schemas['MemberCreate']>,
  Same<z.input<typeof MemberStatusUpdate>, Schemas['MemberStatusUpdate']>,
  Same<z.input<typeof LoanCreate>, Schemas['LoanCreate']>,
  Same<z.input<typeof ReservationCreate>, Schemas['ReservationCreate']>,
  Same<z.output<typeof LoanListQuery>['status'], Schemas['LoanStatus'] | undefined>,
] = [true, true, true, true, true, true, true, true, true, true];
