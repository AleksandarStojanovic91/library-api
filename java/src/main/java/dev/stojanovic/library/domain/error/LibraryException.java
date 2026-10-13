package dev.stojanovic.library.domain.error;

/** A failed business rule. Always a client-side problem (4xx); anything else is a bug or an outage. */
public class LibraryException extends RuntimeException {

    private final ErrorKind kind;

    public LibraryException(ErrorKind kind, String message) {
        super(message, null, false, false);
        this.kind = kind;
    }

    public ErrorKind kind() {
        return kind;
    }

    public static LibraryException notFound(String what) {
        return new LibraryException(ErrorKind.NOT_FOUND, what + " not found");
    }
}
