import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CopyStatus } from '../../domain/catalog/catalog';
import type { ReservationStatus } from '../../domain/lending/reservation';
import type { MemberStatus, Role } from '../../domain/members/member';

/**
 * Drizzle mirror of db/migrations/V1__schema.sql. The SQL files stay the single source of truth for DDL;
 * this file only gives queries types. (books.search is maintained by triggers and never read here.)
 */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull().default('MEMBER'),
  status: text('status').$type<MemberStatus>().notNull().default('ACTIVE'),
  maxActiveLoans: integer('max_active_loans').notNull().default(3),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const authors = pgTable('authors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  bio: text('bio'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  isbn: text('isbn').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  publishedYear: integer('published_year'),
  tags: text('tags').array().notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const bookAuthors = pgTable(
  'book_authors',
  {
    bookId: uuid('book_id').notNull(),
    authorId: uuid('author_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.authorId] })],
);

export const copies = pgTable('copies', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull(),
  barcode: text('barcode').notNull().unique(),
  status: text('status').$type<CopyStatus>().notNull().default('AVAILABLE'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const loans = pgTable('loans', {
  id: uuid('id').primaryKey().defaultRandom(),
  copyId: uuid('copy_id').notNull(),
  bookId: uuid('book_id').notNull(),
  memberId: uuid('member_id').notNull(),
  borrowedAt: timestamptz('borrowed_at').notNull().defaultNow(),
  dueAt: timestamptz('due_at').notNull(),
  returnedAt: timestamptz('returned_at'),
  feeCents: integer('fee_cents'),
  overdueNotifiedAt: timestamptz('overdue_notified_at'),
});

export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull(),
  memberId: uuid('member_id').notNull(),
  status: text('status').$type<ReservationStatus>().notNull().default('WAITING'),
  heldCopyId: uuid('held_copy_id'),
  readyUntil: timestamptz('ready_until'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    subject: text('subject').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subject, t.key] })],
);

export const outbox = pgTable('outbox', {
  // An identity column; mode 'number' is exact up to 2^53, far beyond what this table will reach.
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  publishedAt: timestamptz('published_at'),
  attempts: integer('attempts').notNull().default(0),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  outboxId: bigint('outbox_id', { mode: 'number' }).notNull().unique(),
  memberId: uuid('member_id'),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
