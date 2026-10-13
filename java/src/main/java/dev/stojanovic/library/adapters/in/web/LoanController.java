package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.LoanCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.LoanV1Response;
import dev.stojanovic.library.adapters.in.web.dto.LoanV2Response;
import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.adapters.in.web.support.Paging;
import dev.stojanovic.library.adapters.in.web.support.ProblemCode;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import dev.stojanovic.library.adapters.in.web.support.RequestAttributes;
import dev.stojanovic.library.adapters.in.web.support.RequestHashing;
import dev.stojanovic.library.application.model.IdempotentResult;
import dev.stojanovic.library.application.model.LoanView;
import dev.stojanovic.library.application.model.StoredResponse;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.service.IdempotencyService;
import dev.stojanovic.library.application.service.LoanService;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.error.ValidationException;
import dev.stojanovic.library.domain.model.Actor;
import dev.stojanovic.library.domain.model.LoanStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * Loans in two representations: /api/v2 (current) and /api/v1 (deprecated; the Deprecation/Sunset/Link headers
 * are added by {@code DeprecationHeadersFilter} so error responses carry them too). Both share all business logic.
 */
@RestController
class LoanController {

    static final String IDEMPOTENCY_KEY = "Idempotency-Key";

    private final LoanService loans;
    private final IdempotencyService idempotency;
    private final RequestHashing hashing;
    private final Problems problems;
    private final Paging paging;
    private final JsonMapper json;

    LoanController(LoanService loans, IdempotencyService idempotency, RequestHashing hashing, Problems problems,
                   Paging paging, JsonMapper json) {
        this.loans = loans;
        this.idempotency = idempotency;
        this.hashing = hashing;
        this.problems = problems;
        this.paging = paging;
        this.json = json;
    }

    // ---- v2 ----

    @GetMapping("/api/v2/loans")
    PageResponse<LoanV2Response> listV2(Actor actor,
                                        @RequestParam(required = false) @Min(1) @Max(100) Integer limit,
                                        @RequestParam(required = false) @Size(max = 500) String cursor,
                                        @RequestParam(required = false) UUID memberId,
                                        @RequestParam(required = false) LoanStatus status) {
        return list(actor, limit, cursor, memberId, status, LoanV2Response::from);
    }

    @PostMapping("/api/v2/loans")
    ResponseEntity<String> borrowV2(Actor actor, @RequestHeader(value = IDEMPOTENCY_KEY, required = false) String key,
                                    @Valid @RequestBody LoanCreateRequest body, HttpServletRequest request) {
        return borrow(actor, key, body, request, "/api/v2/loans/", LoanV2Response::from);
    }

    @GetMapping("/api/v2/loans/{loanId}")
    LoanV2Response getV2(Actor actor, @PathVariable UUID loanId) {
        return LoanV2Response.from(loans.get(actor, loanId));
    }

    @PostMapping("/api/v2/loans/{loanId}/return")
    LoanV2Response returnV2(Actor actor, @PathVariable UUID loanId) {
        return LoanV2Response.from(loans.giveBack(actor, loanId));
    }

    // ---- v1 (deprecated) ----

    @GetMapping("/api/v1/loans")
    PageResponse<LoanV1Response> listV1(Actor actor,
                                        @RequestParam(required = false) @Min(1) @Max(100) Integer limit,
                                        @RequestParam(required = false) @Size(max = 500) String cursor,
                                        @RequestParam(required = false) UUID memberId,
                                        @RequestParam(required = false) LoanStatus status) {
        return list(actor, limit, cursor, memberId, status, LoanV1Response::from);
    }

    @PostMapping("/api/v1/loans")
    ResponseEntity<String> borrowV1(Actor actor, @RequestHeader(value = IDEMPOTENCY_KEY, required = false) String key,
                                    @Valid @RequestBody LoanCreateRequest body, HttpServletRequest request) {
        return borrow(actor, key, body, request, "/api/v1/loans/", LoanV1Response::from);
    }

    @GetMapping("/api/v1/loans/{loanId}")
    LoanV1Response getV1(Actor actor, @PathVariable UUID loanId) {
        return LoanV1Response.from(loans.get(actor, loanId));
    }

    @PostMapping("/api/v1/loans/{loanId}/return")
    LoanV1Response returnV1(Actor actor, @PathVariable UUID loanId) {
        return LoanV1Response.from(loans.giveBack(actor, loanId));
    }

    // ---- shared ----

    private <R> PageResponse<R> list(Actor actor, Integer limit, String cursor, UUID memberId, LoanStatus status,
                                     Function<LoanView, R> representation) {
        PageRequest page = paging.request(limit, cursor);
        return paging.response(loans.list(actor, memberId, status, page), page, representation);
    }

    /**
     * The response is rendered to JSON inside the idempotent transaction so exactly these bytes (status, body,
     * Location) can be stored and replayed.
     */
    private ResponseEntity<String> borrow(Actor actor, String key, LoanCreateRequest body, HttpServletRequest request,
                                          String locationPrefix, Function<LoanView, Object> representation) {
        if (key == null) {
            throw new ValidationException(IDEMPOTENCY_KEY, "header is required");
        }
        if (key.length() < 8 || key.length() > 100) {
            throw new ValidationException(IDEMPOTENCY_KEY, "size must be between 8 and 100");
        }
        if (body.memberId() != null && !actor.isLibrarian()) {
            throw new LibraryException(ErrorKind.FORBIDDEN, "Only librarians can borrow on behalf of a member");
        }
        String hash = hashing.hash(request.getMethod(), request.getRequestURI(), body);
        IdempotentResult result = idempotency.execute(actor.memberId().toString(), key, hash,
                () -> {
                    LoanView loan = loans.borrow(actor, body.bookId(), body.memberId());
                    return new StoredResponse(201, json.writeValueAsString(representation.apply(loan)), Map.of(
                            HttpHeaders.LOCATION, locationPrefix + loan.loan().id(),
                            HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE));
                },
                failure -> new StoredResponse(ProblemCode.of(failure.kind()).status().value(),
                        problems.toJson(problems.body(ProblemCode.of(failure.kind()), failure.getMessage(), null,
                                request)),
                        Map.of(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_PROBLEM_JSON_VALUE)));
        return toResponse(result, request);
    }

    private ResponseEntity<String> toResponse(IdempotentResult result, HttpServletRequest request) {
        StoredResponse stored = result.response();
        ResponseEntity.BodyBuilder response = ResponseEntity.status(stored.status());
        stored.headers().forEach(response::header);
        String body = stored.body();
        if (result.replayed()) {
            response.header("Idempotent-Replayed", "true");
            if (MediaType.APPLICATION_PROBLEM_JSON_VALUE.equals(stored.headers().get(HttpHeaders.CONTENT_TYPE))) {
                // A replayed error is the same problem, but it answers this request: point requestId at it.
                ObjectNode problem = (ObjectNode) json.readTree(body);
                problem.put("requestId", RequestAttributes.requestId(request));
                body = json.writeValueAsString(problem);
            }
        }
        return response.body(body);
    }
}
