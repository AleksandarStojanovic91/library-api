/**
 * Creates fresh, isolated test data through the public API (as the librarian), so every test owns its books,
 * copies and members and tests can run in parallel and in any order. Seeded data is only ever read.
 */
import type { ApiResult } from '../client/http';
import { LibraryApi, type Author, type Book, type Copy, type Loan, type Member } from '../client/library-api';
import * as gen from './generators';

/** Kent Beck from the seed data: a safe default author for books whose authors do not matter. */
export const DEFAULT_AUTHOR_ID = '10000000-0000-4000-8000-000000000004';

export interface TestMember {
  member: Member;
  email: string;
  password: string;
  /** Client authenticated as this member. */
  api: LibraryApi;
}

export interface BookOptions {
  title?: string;
  description?: string;
  publishedYear?: number;
  tags?: string[];
  authorIds?: string[];
  /** Number of AVAILABLE copies to add (default 0). */
  copies?: number;
}

/** Fixed-length tuple, so `const [a, b] = await factory.members(2)` gives two defined members. */
type Tuple<T, N extends number, R extends T[] = []> = number extends N ? T[] : R['length'] extends N ? R : Tuple<T, N, [T, ...R]>;

export class SetupError extends Error {
  override name = 'SetupError';
}

/** Setup steps fail loudly with the full response, so a broken fixture is not mistaken for a failed assertion. */
export function ensure<T>(res: ApiResult<T>, status: number, what: string): T {
  if (res.status !== status) throw new SetupError(`Test setup failed (${what}): expected ${status}\n${res.describe()}`);
  return res.body;
}

export async function login(api: LibraryApi, email: string, password: string): Promise<string> {
  const res = await api.as(undefined).auth.token({ email, password });
  return ensure(res, 200, `log in as ${email}`).accessToken;
}

export class TestDataFactory {
  constructor(private readonly librarian: LibraryApi) {}

  async author(name = `Author ${gen.word(8)}`, bio?: string): Promise<Author> {
    return ensure(await this.librarian.authors.create({ name, ...(bio ? { bio } : {}) }), 201, 'create author');
  }

  async book(options: BookOptions = {}): Promise<{ book: Book; copies: Copy[] }> {
    let book: Book | undefined;
    for (let attempt = 1; !book; attempt++) {
      const res = await this.librarian.books.create({
        isbn: gen.isbn(),
        title: options.title ?? `Test Book ${gen.word(8)}`,
        authorIds: options.authorIds ?? [DEFAULT_AUTHOR_ID],
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.publishedYear !== undefined ? { publishedYear: options.publishedYear } : {}),
        ...(options.tags ? { tags: options.tags } : {}),
      });
      // a random ISBN can collide with one from an earlier run: try another
      if (res.status === 409 && attempt < 3) continue;
      book = ensure(res, 201, 'create book');
    }
    const copies: Copy[] = [];
    for (let i = 0; i < (options.copies ?? 0); i++) copies.push(await this.copy(book.id));
    return { book, copies };
  }

  async copy(bookId: string): Promise<Copy> {
    return ensure(await this.librarian.copies.add(bookId, { barcode: gen.barcode() }), 201, 'add copy');
  }

  /** Registers a new member and logs them in. */
  async member(options: { maxActiveLoans?: number; name?: string } = {}): Promise<TestMember> {
    const email = gen.email();
    const password = `pw-${gen.word(12)}`;
    const member = ensure(
      await this.librarian.members.create({
        email,
        password,
        name: options.name ?? `Member ${gen.word(6)}`,
        ...(options.maxActiveLoans !== undefined ? { maxActiveLoans: options.maxActiveLoans } : {}),
      }),
      201,
      'create member',
    );
    const token = await login(this.librarian, email, password);
    return { member, email, password, api: this.librarian.as(token) };
  }

  /** Suspends (or reactivates) a member through PUT /members/{id}/status. */
  async setStatus(who: TestMember, status: 'ACTIVE' | 'SUSPENDED'): Promise<Member> {
    return ensure(await this.librarian.members.setStatus(who.member.id, { status }), 200, `set status ${status}`);
  }

  async members<N extends number>(count: N, options: { maxActiveLoans?: number } = {}): Promise<Tuple<TestMember, N>> {
    return (await Promise.all(Array.from({ length: count }, () => this.member(options)))) as Tuple<TestMember, N>;
  }

  /** Borrows a book for `who` through v2 and returns the loan. */
  async loan(who: TestMember, bookId: string): Promise<Loan> {
    return ensure(await who.api.loans.borrow({ bookId }), 201, `borrow ${bookId}`);
  }
}
