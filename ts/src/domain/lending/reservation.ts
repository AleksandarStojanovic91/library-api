import { HOUR_MS } from '../shared/clock';

export const RESERVATION_STATUSES = ['WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface Reservation {
  readonly id: string;
  readonly bookId: string;
  readonly memberId: string;
  readonly status: ReservationStatus;
  /** 1-based place in the book's FIFO queue; null unless WAITING. */
  readonly position: number | null;
  readonly heldCopyId: string | null;
  readonly readyUntil: Date | null;
  readonly createdAt: Date;
}

export class ReservationPolicy {
  constructor(private readonly holdHours: number) {
    if (!(holdHours > 0)) {
      throw new RangeError('holdHours must be positive');
    }
  }

  /** How long a returned copy waits for the member at the head of the queue. */
  holdUntil(now: Date): Date {
    return new Date(now.getTime() + this.holdHours * HOUR_MS);
  }

  static isOpen(status: ReservationStatus): boolean {
    return status === 'WAITING' || status === 'READY';
  }

  static isCancellable(status: ReservationStatus): boolean {
    return ReservationPolicy.isOpen(status);
  }

  static isExpired(reservation: Pick<Reservation, 'status' | 'readyUntil'>, now: Date): boolean {
    return reservation.status === 'READY' && reservation.readyUntil !== null && reservation.readyUntil.getTime() < now.getTime();
  }
}
