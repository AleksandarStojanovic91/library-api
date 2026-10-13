package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.domain.error.ErrorKind;
import org.springframework.http.HttpStatus;

/** The closed set of problem codes from the contract, with the fixed titles from SPEC.md (Decisions, 7). */
public enum ProblemCode {
    VALIDATION_FAILED("validation-failed", HttpStatus.BAD_REQUEST, "Request validation failed"),
    UNAUTHORIZED("unauthorized", HttpStatus.UNAUTHORIZED, "Authentication required"),
    FORBIDDEN("forbidden", HttpStatus.FORBIDDEN, "Not allowed"),
    NOT_FOUND("not-found", HttpStatus.NOT_FOUND, "Resource not found"),
    CONFLICT("conflict", HttpStatus.CONFLICT, "Conflict"),
    DUPLICATE("duplicate", HttpStatus.CONFLICT, "Resource already exists"),
    NO_COPY_AVAILABLE("no-copy-available", HttpStatus.CONFLICT, "No copy available"),
    LOAN_LIMIT_REACHED("loan-limit-reached", HttpStatus.CONFLICT, "Loan limit reached"),
    MEMBER_SUSPENDED("member-suspended", HttpStatus.CONFLICT, "Member is suspended"),
    ALREADY_RETURNED("already-returned", HttpStatus.CONFLICT, "Loan already returned"),
    BOOK_HAS_ACTIVE_LOANS("book-has-active-loans", HttpStatus.CONFLICT, "Book has copies on loan or on hold"),
    BOOK_HAS_LOAN_HISTORY("book-has-loan-history", HttpStatus.CONFLICT, "Book has loan history"),
    ALREADY_RESERVED("already-reserved", HttpStatus.CONFLICT, "Book already reserved by this member"),
    COPY_AVAILABLE("copy-available", HttpStatus.CONFLICT, "A copy is available, borrow it instead"),
    RESERVATION_NOT_CANCELLABLE("reservation-not-cancellable", HttpStatus.CONFLICT, "Reservation cannot be cancelled"),
    PRECONDITION_FAILED("precondition-failed", HttpStatus.PRECONDITION_FAILED, "Precondition failed"),
    PRECONDITION_REQUIRED("precondition-required", HttpStatus.PRECONDITION_REQUIRED, "Precondition required"),
    IDEMPOTENCY_KEY_REUSED("idempotency-key-reused", HttpStatus.UNPROCESSABLE_CONTENT,
            "Idempotency key reused with a different request"),
    RATE_LIMITED("rate-limited", HttpStatus.TOO_MANY_REQUESTS, "Too many requests"),
    INTERNAL("internal", HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");

    public static final String TYPE_PREFIX = "https://library.example/problems/";

    private final String code;
    private final HttpStatus status;
    private final String title;

    ProblemCode(String code, HttpStatus status, String title) {
        this.code = code;
        this.status = status;
        this.title = title;
    }

    public String code() {
        return code;
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }

    public String type() {
        return TYPE_PREFIX + code;
    }

    public static ProblemCode of(ErrorKind kind) {
        return switch (kind) {
            case VALIDATION -> VALIDATION_FAILED;
            case UNAUTHORIZED -> UNAUTHORIZED;
            case FORBIDDEN -> FORBIDDEN;
            case NOT_FOUND -> NOT_FOUND;
            case CONFLICT -> CONFLICT;
            case DUPLICATE -> DUPLICATE;
            case NO_COPY_AVAILABLE -> NO_COPY_AVAILABLE;
            case LOAN_LIMIT_REACHED -> LOAN_LIMIT_REACHED;
            case MEMBER_SUSPENDED -> MEMBER_SUSPENDED;
            case ALREADY_RETURNED -> ALREADY_RETURNED;
            case BOOK_HAS_ACTIVE_LOANS -> BOOK_HAS_ACTIVE_LOANS;
            case BOOK_HAS_LOAN_HISTORY -> BOOK_HAS_LOAN_HISTORY;
            case ALREADY_RESERVED -> ALREADY_RESERVED;
            case COPY_AVAILABLE -> COPY_AVAILABLE;
            case RESERVATION_NOT_CANCELLABLE -> RESERVATION_NOT_CANCELLABLE;
            case PRECONDITION_FAILED -> PRECONDITION_FAILED;
            case PRECONDITION_REQUIRED -> PRECONDITION_REQUIRED;
            case IDEMPOTENCY_KEY_REUSED -> IDEMPOTENCY_KEY_REUSED;
        };
    }

    /** For errors that reach us only as a status code (servlet container errors); 405 counts as "no such route". */
    public static ProblemCode forStatus(int status) {
        return switch (status) {
            case 401 -> UNAUTHORIZED;
            case 403 -> FORBIDDEN;
            case 404, 405 -> NOT_FOUND;
            case 409 -> CONFLICT;
            case 429 -> RATE_LIMITED;
            default -> status >= 500 ? INTERNAL : VALIDATION_FAILED;
        };
    }
}
