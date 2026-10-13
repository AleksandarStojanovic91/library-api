import type { LoanView } from '../../application/lending/loan-view';
import type { Author, Book, Copy } from '../../domain/catalog/catalog';
import type { Reservation } from '../../domain/lending/reservation';
import type { MemberWithLoans } from '../../domain/members/member';
import { centsToMoney } from '../../domain/shared/money';
import type { Page } from '../../domain/shared/page';
import type { components } from '../../generated/openapi';

type Schemas = components['schemas'];

/** Domain objects -> contract representations. The return types are the generated contract types. */

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export function presentPage<T, R>(page: Page<T>, present: (item: T) => R): { data: R[]; page: Schemas['PageInfo'] } {
  return { data: page.items.map(present), page: { limit: page.limit, nextCursor: page.nextCursor } };
}

export function presentBook(book: Book): Schemas['Book'] {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    description: book.description,
    publishedYear: book.publishedYear,
    authors: book.authors.map(({ id, name }) => ({ id, name })),
    tags: [...book.tags],
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
    version: book.version,
    createdAt: iso(book.createdAt),
    updatedAt: iso(book.updatedAt),
  };
}

export function presentAuthor(author: Author): Schemas['Author'] {
  return { id: author.id, name: author.name, bio: author.bio, createdAt: iso(author.createdAt) };
}

export function presentCopy(copy: Copy): Schemas['Copy'] {
  return { id: copy.id, bookId: copy.bookId, barcode: copy.barcode, status: copy.status, createdAt: iso(copy.createdAt) };
}

export function presentMember(member: MemberWithLoans): Schemas['Member'] {
  return {
    id: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
    status: member.status,
    maxActiveLoans: member.maxActiveLoans,
    activeLoans: member.activeLoans,
    createdAt: iso(member.createdAt),
  };
}

/** v1 (deprecated): flat ids, fee as integer cents. */
export function presentLoanV1(loan: LoanView): Schemas['LoanV1'] {
  return {
    id: loan.id,
    bookId: loan.bookId,
    copyId: loan.copyId,
    memberId: loan.memberId,
    status: loan.status,
    borrowedAt: iso(loan.borrowedAt),
    dueAt: iso(loan.dueAt),
    returnedAt: isoOrNull(loan.returnedAt),
    feeCents: loan.feeCents,
  };
}

/** v2: embedded book and copy, overdue days, fee as Money (live while the loan is open and overdue). */
export function presentLoanV2(loan: LoanView): Schemas['Loan'] {
  return {
    id: loan.id,
    book: { id: loan.book.id, title: loan.book.title, isbn: loan.book.isbn },
    copy: { id: loan.copy.id, barcode: loan.copy.barcode },
    memberId: loan.memberId,
    status: loan.status,
    borrowedAt: iso(loan.borrowedAt),
    dueAt: iso(loan.dueAt),
    returnedAt: isoOrNull(loan.returnedAt),
    overdueDays: loan.overdueDays,
    fee: loan.currentFeeCents === null ? null : centsToMoney(loan.currentFeeCents),
  };
}

export function presentReservation(reservation: Reservation): Schemas['Reservation'] {
  return {
    id: reservation.id,
    bookId: reservation.bookId,
    memberId: reservation.memberId,
    status: reservation.status,
    position: reservation.position,
    heldCopyId: reservation.heldCopyId,
    readyUntil: isoOrNull(reservation.readyUntil),
    createdAt: iso(reservation.createdAt),
  };
}
