package dev.stojanovic.library.domain.error;

/** Business outcomes that are not "success". Adapters translate them to transport-level errors. */
public enum ErrorKind {
    VALIDATION,
    UNAUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    CONFLICT,
    DUPLICATE,
    NO_COPY_AVAILABLE,
    LOAN_LIMIT_REACHED,
    MEMBER_SUSPENDED,
    ALREADY_RETURNED,
    BOOK_HAS_ACTIVE_LOANS,
    BOOK_HAS_LOAN_HISTORY,
    ALREADY_RESERVED,
    COPY_AVAILABLE,
    RESERVATION_NOT_CANCELLABLE,
    PRECONDITION_FAILED,
    PRECONDITION_REQUIRED,
    IDEMPOTENCY_KEY_REUSED
}
