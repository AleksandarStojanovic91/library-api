package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

class BooksIT extends IntegrationTest {

    private Api.Response create(Map<String, Object> body) {
        return api.post("/api/v1/books").token(data.librarian()).json(body).send();
    }

    private Map<String, Object> validBook() {
        Map<String, Object> book = new HashMap<>();
        book.put("isbn", Fixtures.randomIsbn());
        book.put("title", "Refactoring " + UUID.randomUUID());
        book.put("description", "Improving the design of existing code.");
        book.put("publishedYear", 2018);
        book.put("authorIds", List.of(Fixtures.KENT_BECK));
        book.put("tags", List.of("software", "design"));
        return book;
    }

    @Test
    void createThenReadReturnsTheSameRepresentation() {
        Api.Response created = create(validBook());
        assertThat(created.status()).isEqualTo(201);
        assertThat(created.header("Location")).isEqualTo("/api/v1/books/" + created.id());
        assertThat(created.header("ETag")).isEqualTo("\"1\"");
        assertThat(created.json().get("totalCopies").asInt()).isZero();
        assertThat(created.json().get("authors").get(0).get("name").asString()).isEqualTo("Kent Beck");

        Api.Response read = api.get("/api/v1/books/" + created.id()).send();
        assertThat(read.json()).isEqualTo(created.json());
        assertThat(read.header("ETag")).isEqualTo("\"1\"");
    }

    @Test
    void nullableFieldsAreSerialisedAsNull() {
        Map<String, Object> minimal = validBook();
        minimal.remove("description");
        minimal.remove("publishedYear");
        minimal.remove("tags");
        Api.Response created = create(minimal);
        assertThat(created.json().has("description")).isTrue();
        assertThat(created.json().get("description").isNull()).isTrue();
        assertThat(created.json().get("publishedYear").isNull()).isTrue();
        assertThat(created.json().get("tags").isEmpty()).isTrue();
    }

    @Test
    void validationReportsEveryFailingField() {
        Map<String, Object> bad = new HashMap<>();
        bad.put("isbn", "9780132350885"); // wrong check digit
        bad.put("title", "");
        bad.put("authorIds", List.of(Fixtures.KENT_BECK, "not-a-uuid"));
        bad.put("publishedYear", 1000);
        bad.put("tags", List.of("ok", ""));
        Api.Response response = create(bad);

        assertThat(response.status()).isEqualTo(400);
        assertThat(response.code()).isEqualTo("validation-failed");
        assertThat(response.json().get("errors").findValuesAsString("field"))
                .contains("isbn", "title", "authorIds.1", "publishedYear", "tags.1");
    }

    @Test
    void rejectsUnknownAuthorsUnknownPropertiesAndMalformedJson() {
        Map<String, Object> unknownAuthor = validBook();
        unknownAuthor.put("authorIds", List.of(Fixtures.MISSING_ID));
        assertThat(create(unknownAuthor).json().get("errors").findValuesAsString("field")).containsExactly("authorIds");

        Map<String, Object> extra = validBook();
        extra.put("availableCopies", 10);
        assertThat(create(extra).status()).isEqualTo(400);

        Api.Response malformed = api.post("/api/v1/books").token(data.librarian()).json("{\"isbn\": \"978").send();
        assertThat(malformed.status()).isEqualTo(400);
        assertThat(malformed.text("detail")).isEqualTo("Malformed JSON body");

        Map<String, Object> stringYear = validBook();
        stringYear.put("publishedYear", "1999");
        assertThat(create(stringYear).json().get("errors").findValuesAsString("field")).containsExactly("publishedYear");
    }

    @Test
    void duplicateIsbnIsAConflict() {
        Map<String, Object> book = validBook();
        assertThat(create(book).status()).isEqualTo(201);
        Api.Response again = create(book);
        assertThat(again.status()).isEqualTo(409);
        assertThat(again.code()).isEqualTo("duplicate");
    }

    @Test
    void conditionalGetAndCacheHeaders() {
        String id = create(validBook()).id();

        Api.Response first = api.get("/api/v1/books/" + id).send();
        Api.Response second = api.get("/api/v1/books/" + id).send();
        assertThat(first.header("X-Cache")).isEqualTo("MISS");
        assertThat(second.header("X-Cache")).isEqualTo("HIT");

        Api.Response notModified = api.get("/api/v1/books/" + id).header("If-None-Match", "\"1\"").send();
        assertThat(notModified.status()).isEqualTo(304);
        assertThat(notModified.body()).isEmpty();
        assertThat(notModified.header("ETag")).isEqualTo("\"1\"");
    }

    @Test
    void patchNeedsAMatchingIfMatchAndAppliesAMergePatch() {
        String id = create(validBook()).id();
        String path = "/api/v1/books/" + id;
        String otherAuthor = "10000000-0000-4000-8000-000000000003";
        String tag = "t" + UUID.randomUUID().toString().substring(0, 8);

        Api.Response missing = api.patch(path).token(data.librarian()).json(Map.of("title", "x")).send();
        assertThat(missing.status()).isEqualTo(428);
        assertThat(missing.code()).isEqualTo("precondition-required");

        Api.Response stale = api.patch(path).token(data.librarian()).header("If-Match", "\"999\"")
                .json(Map.of("title", "x")).send();
        assertThat(stale.status()).isEqualTo(412);

        api.get(path).send(); // warm the cache, so the PATCH must evict it
        Map<String, Object> patch = new HashMap<>();
        patch.put("description", null);
        patch.put("publishedYear", null);
        patch.put("tags", List.of(tag));
        patch.put("authorIds", List.of(otherAuthor));
        Api.Response patched = api.patch(path).token(data.librarian()).header("If-Match", "\"1\"")
                .header("Content-Type", "application/merge-patch+json").json(patch).send();
        assertThat(patched.status()).isEqualTo(200);
        assertThat(patched.header("ETag")).isEqualTo("\"2\"");
        assertThat(patched.json().get("description").isNull()).isTrue();
        assertThat(patched.json().get("publishedYear").isNull()).isTrue();
        assertThat(patched.json().get("authors").findValuesAsString("name")).containsExactly("Eric Evans");

        Api.Response reread = api.get(path).send();
        assertThat(reread.header("X-Cache")).isEqualTo("MISS");
        assertThat(reread.json().get("version").asInt()).isEqualTo(2);

        JsonNode found = api.get("/api/v1/books?q=evans&tag=" + tag).send().json();
        assertThat(Fixtures.ids(found)).containsExactly(id);
    }

    @Test
    void patchRejectsInvalidPatchesWithoutChangingTheBook() {
        String id = create(validBook()).id();
        for (String body : List.of("{}", "{\"title\": null}", "{\"publishedYear\": 3000}", "{\"authorIds\": []}",
                "{\"isbn\": \"9780132350884\"}", "{\"authorIds\": [\"" + Fixtures.MISSING_ID + "\"]}")) {
            Api.Response response = api.patch("/api/v1/books/" + id).token(data.librarian())
                    .header("If-Match", "\"1\"").json(body).send();
            assertThat(response.status()).as(body).isEqualTo(400);
        }
        assertThat(data.book(id).get("version").asInt()).isEqualTo(1);
    }

    @Test
    void concurrentPatchesWithTheSameETagHaveExactlyOneWinner() throws Exception {
        String id = create(validBook()).id();
        List<Callable<Integer>> patches = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            String title = "Winner " + i;
            patches.add(() -> api.patch("/api/v1/books/" + id).token(data.librarian()).header("If-Match", "\"1\"")
                    .json(Map.of("title", title)).send().status());
        }
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Integer> statuses = new ArrayList<>();
            for (var f : pool.invokeAll(patches)) {
                statuses.add(f.get());
            }
            assertThat(statuses).containsOnly(200, 412).filteredOn(s -> s == 200).hasSize(1);
        }
        assertThat(data.book(id).get("version").asInt()).isEqualTo(2);
    }

    @Test
    void deleteRules() {
        Fixtures.Member member = data.member();

        Fixtures.Book idle = data.book(2);
        assertThat(api.delete("/api/v1/books/" + idle.id()).token(data.librarian()).send().status()).isEqualTo(204);
        assertThat(api.get("/api/v1/books/" + idle.id()).send().status()).isEqualTo(404);
        assertThat(api.get("/api/v1/books/" + idle.id() + "/copies").send().status()).isEqualTo(404);

        Fixtures.Book lent = data.book(1);
        String loanId = data.borrow(member.token(), lent.id()).id();
        Api.Response active = api.delete("/api/v1/books/" + lent.id()).token(data.librarian()).send();
        assertThat(active.code()).isEqualTo("book-has-active-loans");

        data.giveBack(member.token(), loanId);
        Api.Response history = api.delete("/api/v1/books/" + lent.id()).token(data.librarian()).send();
        assertThat(history.status()).isEqualTo(409);
        assertThat(history.code()).isEqualTo("book-has-loan-history");
    }

    @Test
    void copiesHaveUniqueBarcodesAndUpdateTheCounters() {
        Fixtures.Book book = data.book(0);
        Api.Response copy = data.addCopy(book.id());
        assertThat(copy.text("status")).isEqualTo("AVAILABLE");
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);

        Api.Response duplicate = api.post("/api/v1/books/" + data.book(1).id() + "/copies").token(data.librarian())
                .json(Map.of("barcode", copy.text("barcode"))).send();
        assertThat(duplicate.code()).isEqualTo("duplicate");

        Api.Response invalid = api.post("/api/v1/books/" + book.id() + "/copies").token(data.librarian())
                .json(Map.of("barcode", "abc-1")).send();
        assertThat(invalid.json().get("errors").findValuesAsString("field")).containsExactly("barcode");
    }

    @Test
    void searchUsesFullTextFirstAndTrigramsOnlyAsAFallback() {
        String marker = "zq" + UUID.randomUUID().toString().substring(0, 6);
        String exact = data.book("Quantum Gardening " + marker, 0, List.of()).id();
        String similar = data.book("Quantum Gardenin " + marker, 0, List.of()).id();

        JsonNode fullText = api.get("/api/v1/books?q=gardening%20" + marker).send().json();
        assertThat(Fixtures.ids(fullText)).containsExactly(exact);

        JsonNode typo = api.get("/api/v1/books?q=Quantum%20Gardeming%20" + marker).send().json();
        assertThat(Fixtures.ids(typo)).contains(exact, similar);

        JsonNode nothing = api.get("/api/v1/books?q=xyzzy%20plugh" + marker).send().json();
        assertThat(nothing.get("data").isEmpty()).isTrue();
        assertThat(nothing.get("page").get("nextCursor").isNull()).isTrue();
    }

    @Test
    void availabilityFilterFollowsLoans() {
        String tag = "avail-" + UUID.randomUUID().toString().substring(0, 8);
        Fixtures.Book withCopy = data.book("Available " + tag, 1, List.of(tag));
        Fixtures.Book withoutCopies = data.book("No copies " + tag, 0, List.of(tag));

        assertThat(ids("/api/v1/books?available=true&tag=" + tag)).containsExactly(withCopy.id());
        assertThat(ids("/api/v1/books?available=false&tag=" + tag)).containsExactly(withoutCopies.id());

        data.borrow(data.member().token(), withCopy.id());
        assertThat(ids("/api/v1/books?available=true&tag=" + tag)).isEmpty();
        assertThat(ids("/api/v1/books?available=false&tag=" + tag)).hasSize(2);
    }

    @Test
    void malformedIdsAreValidationErrors() {
        Api.Response response = api.get("/api/v1/books/not-a-uuid").send();
        assertThat(response.status()).isEqualTo(400);
        assertThat(response.json().get("errors").findValuesAsString("field")).containsExactly("bookId");
        assertThat(api.get("/api/v1/books?authorId=nope").send().status()).isEqualTo(400);
    }

    private List<String> ids(String path) {
        return Fixtures.ids(api.get(path).send().json());
    }
}
