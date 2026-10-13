/** Integration events written to the transactional outbox in the same transaction as the change. */
export type LendingEvent =
  | { type: 'loan.created'; aggregateId: string; payload: { loanId: string; memberId: string; bookId: string; copyId: string; dueAt: string } }
  | { type: 'loan.returned'; aggregateId: string; payload: { loanId: string; memberId: string; bookId: string; copyId: string; feeCents: number | null } }
  | { type: 'loan.overdue'; aggregateId: string; payload: { loanId: string; memberId: string; bookId: string; dueAt: string } }
  | { type: 'reservation.ready'; aggregateId: string; payload: { reservationId: string; memberId: string; bookId: string; copyId: string; readyUntil: string } }
  | { type: 'reservation.expired'; aggregateId: string; payload: { reservationId: string; memberId: string; bookId: string } };

export type LendingEventType = LendingEvent['type'];

export function aggregateTypeOf(event: LendingEvent): 'loan' | 'reservation' {
  return event.type.startsWith('loan.') ? 'loan' : 'reservation';
}
