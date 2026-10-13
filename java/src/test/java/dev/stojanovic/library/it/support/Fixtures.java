package dev.stojanovic.library.it.support;

import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import static org.assertj.core.api.Assertions.assertThat;

/** Creates test data through the public API, so every test owns its data and tests never depend on each other. */
public class Fixtures {

    public static final String LIBRARIAN_ID = "00000000-0000-4000-8000-000000000001";
    public static final String MEMBER_ID = "00000000-0000-4000-8000-000000000002";
    public static final String KENT_BECK = "10000000-0000-4000-8000-000000000004";
    public static final String MISSING_ID = "00000000-0000-4000-8000-00000000dead";

    private static volatile String librarianToken;

    private final Api api;

    public Fixtures(Api api) {
        this.api = api;
    }

    public record Member(String id, String email, String token) {
    }

    public record Book(String id, List<String> copyIds) {
    }

    public String librarian() {
        if (librarianToken == null) {
            librarianToken = login("librarian@library.test", "librarian-pass-123");
        }
        return librarianToken;
    }

    public String seededMember() {
        return login("member@library.test", "member-pass-123");
    }

    public String login(String email, String password) {
        Api.Response response = api.post("/api/v1/auth/token").json(Map.of("email", email, "password", password)).send();
        assertThat(response.status()).as(response.toString()).isEqualTo(200);
        return response.text("accessToken");
    }

    public Member member() {
        return member(3);
    }

    public Member member(int maxActiveLoans) {
        String email = "it-" + UUID.randomUUID() + "@test.library.test";
        Api.Response created = api.post("/api/v1/members").token(librarian())
                .json(Map.of("email", email, "name", "IT member", "password", "it-password-123",
                        "maxActiveLoans", maxActiveLoans))
                .send();
        assertThat(created.status()).as(created.toString()).isEqualTo(201);
        return new Member(created.id(), email, login(email, "it-password-123"));
    }

    public Book book(int copies) {
        return book("IT book " + UUID.randomUUID(), copies, List.of());
    }

    public Book book(String title, int copies, List<String> tags) {
        Api.Response created = api.post("/api/v1/books").token(librarian())
                .json(Map.of("isbn", randomIsbn(), "title", title, "authorIds", List.of(KENT_BECK), "tags", tags))
                .send();
        assertThat(created.status()).as(created.toString()).isEqualTo(201);
        List<String> copyIds = new ArrayList<>();
        for (int i = 0; i < copies; i++) {
            copyIds.add(addCopy(created.id()).id());
        }
        return new Book(created.id(), copyIds);
    }

    public Api.Response addCopy(String bookId) {
        Api.Response copy = api.post("/api/v1/books/" + bookId + "/copies").token(librarian())
                .json(Map.of("barcode", "IT-" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextLong()).toUpperCase()))
                .send();
        assertThat(copy.status()).as(copy.toString()).isEqualTo(201);
        return copy;
    }

    public Api.Response borrow(String token, String bookId) {
        return borrow(token, bookId, UUID.randomUUID().toString());
    }

    public Api.Response borrow(String token, String bookId, String idempotencyKey) {
        return api.post("/api/v2/loans").token(token).header("Idempotency-Key", idempotencyKey)
                .json(Map.of("bookId", bookId)).send();
    }

    public Api.Response giveBack(String token, String loanId) {
        return api.post("/api/v2/loans/" + loanId + "/return").token(token).send();
    }

    public Api.Response reserve(String token, String bookId) {
        return api.post("/api/v1/reservations").token(token).json(Map.of("bookId", bookId)).send();
    }

    public JsonNode book(String bookId) {
        return api.get("/api/v1/books/" + bookId).send().json();
    }

    public JsonNode reservation(String bookId, String reservationId) {
        for (JsonNode r : api.get("/api/v1/reservations?limit=100&bookId=" + bookId).token(librarian()).send().json().get("data")) {
            if (r.get("id").asString().equals(reservationId)) {
                return r;
            }
        }
        throw new AssertionError("reservation " + reservationId + " not found");
    }

    public String copyStatus(String bookId, String copyId) {
        for (JsonNode c : api.get("/api/v1/books/" + bookId + "/copies").send().json().get("data")) {
            if (c.get("id").asString().equals(copyId)) {
                return c.get("status").asString();
            }
        }
        throw new AssertionError("copy " + copyId + " not found");
    }

    /** The {@code id} of every row of a page ({@code data[*].id}, not nested ids). */
    public static List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.get("data").forEach(row -> ids.add(row.get("id").asString()));
        return ids;
    }

    /** 978 + 9 random digits + the check digit. */
    public static String randomIsbn() {
        StringBuilder isbn = new StringBuilder("978");
        for (int i = 0; i < 9; i++) {
            isbn.append(ThreadLocalRandom.current().nextInt(10));
        }
        return isbn.append(dev.stojanovic.library.domain.model.Isbn.checkDigit(isbn.toString())).toString();
    }
}
