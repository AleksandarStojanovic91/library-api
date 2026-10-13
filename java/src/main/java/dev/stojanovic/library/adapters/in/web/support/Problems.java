package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.domain.error.FieldViolation;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.List;

/** Builds problem documents the same way for controllers, filters, security handlers and the error page. */
@Component
public class Problems {

    private final JsonMapper json;

    public Problems(JsonMapper json) {
        this.json = json;
    }

    public ProblemBody body(ProblemCode code, String detail, List<FieldViolation> violations,
                            HttpServletRequest request) {
        List<ProblemBody.FieldError> errors = violations == null || violations.isEmpty() ? null
                : violations.stream().map(v -> new ProblemBody.FieldError(v.field(), v.message())).toList();
        return new ProblemBody(code.type(), code.title(), code.status().value(), detail, instance(request),
                code.code(), errors, RequestAttributes.requestId(request));
    }

    public ResponseEntity<ProblemBody> entity(ProblemCode code, String detail, List<FieldViolation> violations,
                                              HttpServletRequest request) {
        return ResponseEntity.status(code.status())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(body(code, detail, violations, request));
    }

    public String toJson(ProblemBody body) {
        return json.writeValueAsString(body);
    }

    /** For code running outside Spring MVC (filters, security entry points). */
    public void write(HttpServletRequest request, HttpServletResponse response, ProblemCode code, String detail)
            throws IOException {
        response.setStatus(code.status().value());
        response.setHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getOutputStream().write(json.writeValueAsBytes(body(code, detail, null, request)));
    }

    /** The original path, also when we are rendering an error dispatch to /error. */
    private static String instance(HttpServletRequest request) {
        Object original = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
        return original != null ? original.toString() : request.getRequestURI();
    }
}
