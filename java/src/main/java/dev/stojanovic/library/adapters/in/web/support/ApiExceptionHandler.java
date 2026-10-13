package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.FieldViolation;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.error.ValidationException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.validation.method.ParameterErrors;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import tools.jackson.core.JacksonException;
import tools.jackson.core.exc.StreamReadException;
import tools.jackson.databind.exc.MismatchedInputException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/** Maps every failure to an RFC 9457 problem; nothing else (and never a stack trace) leaves the service. */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    static final String MALFORMED_JSON = "Malformed JSON body";

    private final Problems problems;

    public ApiExceptionHandler(Problems problems) {
        this.problems = problems;
    }

    @ExceptionHandler(ValidationException.class)
    ResponseEntity<ProblemBody> validation(ValidationException e, HttpServletRequest request) {
        return invalid(e.violations(), request);
    }

    @ExceptionHandler(LibraryException.class)
    ResponseEntity<ProblemBody> business(LibraryException e, HttpServletRequest request) {
        ResponseEntity<ProblemBody> response = problems.entity(ProblemCode.of(e.kind()), e.getMessage(), null, request);
        if (e.kind() == ErrorKind.UNAUTHORIZED) {
            // every 401 carries the challenge, also a failed login (RFC 9110 11.6.1)
            return ResponseEntity.status(response.getStatusCode()).headers(response.getHeaders())
                    .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer").body(response.getBody());
        }
        return response;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemBody> invalidBody(MethodArgumentNotValidException e, HttpServletRequest request) {
        return invalid(violations(e.getBindingResult().getAllErrors()), request);
    }

    /** Constraint violations on @RequestParam / @RequestHeader / @PathVariable (Spring's built-in method validation). */
    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ProblemBody> invalidParameters(HandlerMethodValidationException e, HttpServletRequest request) {
        List<FieldViolation> violations = new ArrayList<>();
        for (ParameterValidationResult result : e.getParameterValidationResults()) {
            if (result instanceof ParameterErrors errors) {
                violations.addAll(violations(errors.getAllErrors()));
                continue;
            }
            String name = parameterName(result);
            for (MessageSourceResolvable error : result.getResolvableErrors()) {
                violations.add(new FieldViolation(name, error.getDefaultMessage()));
            }
        }
        return invalid(violations, request);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ProblemBody> typeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest request) {
        return invalid(List.of(new FieldViolation(e.getName(), "Invalid value")), request);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<ProblemBody> missingParameter(MissingServletRequestParameterException e,
                                                 HttpServletRequest request) {
        return invalid(List.of(new FieldViolation(e.getParameterName(), "is required")), request);
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ProblemBody> missingHeader(MissingRequestHeaderException e, HttpServletRequest request) {
        return invalid(List.of(new FieldViolation(e.getHeaderName(), "header is required")), request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ProblemBody> unreadable(HttpMessageNotReadableException e, HttpServletRequest request) {
        Throwable cause = e.getCause();
        if (isSyntaxError(e)) {
            return problems.entity(ProblemCode.VALIDATION_FAILED, MALFORMED_JSON, null, request);
        }
        if (cause instanceof UnrecognizedPropertyException unknown) {
            return invalid(List.of(new FieldViolation(path(unknown), "Unknown property")), request);
        }
        if (cause instanceof MismatchedInputException mismatch && !mismatch.getPath().isEmpty()) {
            return invalid(List.of(new FieldViolation(path(mismatch), "Invalid value")), request);
        }
        // valid JSON of the wrong shape (an array, a string) is "malformed" for this API too, as SPEC words it
        String detail = cause == null ? "Request body is required" : MALFORMED_JSON;
        return problems.entity(ProblemCode.VALIDATION_FAILED, detail, null, request);
    }

    /** Broken JSON text (as opposed to valid JSON of the wrong shape), wherever it sits in the cause chain. */
    private static boolean isSyntaxError(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof StreamReadException
                    || (t instanceof JacksonException && String.valueOf(t.getMessage()).startsWith("Unexpected end-of-input"))) {
                return true;
            }
        }
        return false;
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ProblemBody> noRoute(NoResourceFoundException e, HttpServletRequest request) {
        return problems.entity(ProblemCode.NOT_FOUND,
                "No route for " + request.getMethod() + " " + request.getRequestURI(), null, request);
    }

    /**
     * The contract has no codes for 405/406/415 and every code is pinned to one status, so these are reported as
     * 404 not-found (no such route for this method) and 400 validation-failed, like the TypeScript service.
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ProblemBody> methodNotAllowed(HttpRequestMethodNotSupportedException e,
                                                 HttpServletRequest request) {
        ResponseEntity<ProblemBody> response = problems.entity(ProblemCode.NOT_FOUND,
                "No route for " + e.getMethod() + " " + request.getRequestURI(), null, request);
        HttpHeaders headers = new HttpHeaders();
        headers.putAll(response.getHeaders());
        if (e.getSupportedHttpMethods() != null) {
            headers.setAllow(e.getSupportedHttpMethods());
        }
        return new ResponseEntity<>(response.getBody(), headers, response.getStatusCode());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ProblemBody> unsupportedMediaType(HttpMediaTypeNotSupportedException e,
                                                     HttpServletRequest request) {
        return problems.entity(ProblemCode.VALIDATION_FAILED,
                "Unsupported Content-Type " + e.getContentType() + "; send application/json", null, request);
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<ProblemBody> notAcceptable(HttpMediaTypeNotAcceptableException e, HttpServletRequest request) {
        return problems.entity(ProblemCode.VALIDATION_FAILED, "This API only produces application/json", null,
                request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemBody> unexpected(Exception e, HttpServletRequest request) {
        log.error("Unhandled error on {} {}", request.getMethod(), request.getRequestURI(), e);
        return problems.entity(ProblemCode.INTERNAL, "An unexpected error occurred; quote the requestId when reporting it",
                null, request);
    }

    private ResponseEntity<ProblemBody> invalid(List<FieldViolation> violations, HttpServletRequest request) {
        String detail = violations.stream().map(v -> v.field() + ": " + v.message()).collect(Collectors.joining("; "));
        return problems.entity(ProblemCode.VALIDATION_FAILED, detail, violations, request);
    }

    private static List<FieldViolation> violations(List<? extends ObjectError> errors) {
        return errors.stream().map(error -> error instanceof FieldError field
                ? new FieldViolation(jsonPointer(field.getField()), field.getDefaultMessage())
                : new FieldViolation(error.getObjectName(), error.getDefaultMessage())).toList();
    }

    /** {@code authorIds[0]} (Spring property path) to {@code authorIds.0} (JSON pointer without the slash). */
    static String jsonPointer(String propertyPath) {
        return propertyPath.replaceAll("\\[(\\d+)]", ".$1").replaceAll("\\[([^]]*)]", ".$1");
    }

    private static String path(JacksonException e) {
        return e.getPath().stream()
                .map(ref -> ref.getPropertyName() != null ? ref.getPropertyName() : Integer.toString(ref.getIndex()))
                .collect(Collectors.joining("."));
    }

    private static String parameterName(ParameterValidationResult result) {
        RequestParam param = result.getMethodParameter().getParameterAnnotation(RequestParam.class);
        if (param != null && !param.name().isEmpty()) {
            return param.name();
        }
        RequestHeader header = result.getMethodParameter().getParameterAnnotation(RequestHeader.class);
        if (header != null && !header.name().isEmpty()) {
            return header.name();
        }
        return result.getMethodParameter().getParameterName();
    }
}
