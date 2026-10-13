package dev.stojanovic.library.adapters.in.web.support;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** RFC 9457 problem details plus the contract's {@code code}, {@code errors} and {@code requestId} members. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProblemBody(String type, String title, int status, String detail, String instance, String code,
                          List<FieldError> errors, String requestId) {

    public record FieldError(String field, String message) {
    }
}
