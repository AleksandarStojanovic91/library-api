package dev.stojanovic.library.domain.error;

import java.util.List;

public class ValidationException extends LibraryException {

    private final List<FieldViolation> violations;

    public ValidationException(List<FieldViolation> violations) {
        super(ErrorKind.VALIDATION, "Request validation failed");
        this.violations = List.copyOf(violations);
    }

    public ValidationException(String field, String message) {
        this(List.of(new FieldViolation(field, message)));
    }

    public List<FieldViolation> violations() {
        return violations;
    }
}
