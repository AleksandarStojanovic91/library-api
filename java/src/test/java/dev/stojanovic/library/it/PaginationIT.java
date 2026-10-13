package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PaginationIT extends IntegrationTest {

    private String tag() {
        return "page-" + UUID.randomUUID().toString().substring(0, 8);
    }

    /** Follows nextCursor to the end; returns the pages' sizes and all rows in order. */
    private List<JsonNode> walk(String path, String token, List<Integer> pageSizes) {
        List<JsonNode> rows = new ArrayList<>();
        String cursor = null;
        do {
            String url = path + (cursor == null ? "" : "&cursor=" + URLEncoder.encode(cursor, StandardCharsets.UTF_8));
            JsonNode page = api.get(url).token(token).send().json();
            page.get("data").forEach(rows::add);
            pageSizes.add(page.get("data").size());
            cursor = page.get("page").get("nextCursor").isNull() ? null : page.get("page").get("nextCursor").asString();
        } while (cursor != null);
        return rows;
    }

    @Test
    void titleOrderIsCaseInsensitiveAndPagesHaveNoGapsOrDuplicates() {
        String tag = tag();
        for (String title : List.of("golf", "Echo", "Alpha", "delta", "bravo", "foxtrot", "charlie")) {
            data.book(title, 0, List.of(tag));
        }
        List<Integer> sizes = new ArrayList<>();
        List<JsonNode> rows = walk("/api/v1/books?limit=3&tag=" + tag, null, sizes);

        assertThat(sizes).containsExactly(3, 3, 1);
        assertThat(rows).extracting(r -> r.get("title").asString())
                .containsExactly("Alpha", "bravo", "charlie", "delta", "Echo", "foxtrot", "golf");
    }

    @Test
    void aFullLastPageHasNoNextCursor() {
        String tag = tag();
        for (int i = 0; i < 4; i++) {
            data.book("Same title", 0, List.of(tag));
        }
        List<Integer> sizes = new ArrayList<>();
        List<JsonNode> rows = walk("/api/v1/books?limit=2&tag=" + tag, null, sizes);
        assertThat(sizes).containsExactly(2, 2);
        assertThat(rows).extracting(r -> r.get("id").asString()).doesNotHaveDuplicates().hasSize(4);
    }

    @Test
    void publishedYearDescendingPutsBooksWithoutAYearLast() {
        String tag = tag();
        for (Integer year : new Integer[]{2001, null, 1990, 2015, null, 2001}) {
            Map<String, Object> book = new HashMap<>();
            book.put("isbn", Fixtures.randomIsbn());
            book.put("title", "Year " + year);
            book.put("authorIds", List.of(Fixtures.KENT_BECK));
            book.put("tags", List.of(tag));
            if (year != null) {
                book.put("publishedYear", year);
            }
            assertThat(api.post("/api/v1/books").token(data.librarian()).json(book).send().status()).isEqualTo(201);
        }
        List<JsonNode> rows = walk("/api/v1/books?limit=2&sort=-publishedYear&tag=" + tag, null, new ArrayList<>());
        assertThat(rows).extracting(r -> r.get("publishedYear").isNull() ? null : r.get("publishedYear").asInt())
                .containsExactly(2015, 2001, 2001, 1990, null, null);
    }

    @Test
    void keysetPagesAreStableWhenRowsAreInsertedBeforeTheCursor() {
        String tag = tag();
        for (String title : List.of("b", "c", "d", "e")) {
            data.book(title, 0, List.of(tag));
        }
        JsonNode first = api.get("/api/v1/books?limit=2&tag=" + tag).send().json();
        data.book("a", 0, List.of(tag)); // would shift an OFFSET-based second page
        String cursor = first.get("page").get("nextCursor").asString();
        JsonNode second = api.get("/api/v1/books?limit=2&tag=" + tag + "&cursor=" + cursor).send().json();
        assertThat(second.get("data").findValuesAsString("title")).containsExactly("d", "e");
    }

    @Test
    void searchResultsPageWithoutDuplicates() {
        String marker = "pg" + UUID.randomUUID().toString().substring(0, 6);
        for (int i = 0; i < 5; i++) {
            data.book("Search paging " + marker + " " + i, 0, List.of());
        }
        List<Integer> sizes = new ArrayList<>();
        List<JsonNode> rows = walk("/api/v1/books?limit=2&q=" + marker, null, sizes);
        assertThat(sizes).containsExactly(2, 2, 1);
        assertThat(rows).extracting(r -> r.get("id").asString()).doesNotHaveDuplicates();
    }

    @Test
    void loansAreNewestFirstAcrossPages() {
        Fixtures.Member member = data.member(3);
        List<String> created = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            created.add(data.borrow(member.token(), data.book(1).id()).id());
        }
        List<JsonNode> rows = walk("/api/v2/loans?limit=2", member.token(), new ArrayList<>());
        assertThat(rows).extracting(r -> r.get("id").asString()).containsExactlyElementsOf(created.reversed());
    }

    @Test
    void membersAndAuthorsPageByCreationTime() {
        for (int i = 0; i < 3; i++) {
            api.post("/api/v1/authors").token(data.librarian()).json(Map.of("name", "Author " + i)).send();
            data.member();
        }
        List<JsonNode> authors = walk("/api/v1/authors?limit=2", null, new ArrayList<>());
        assertThat(authors).extracting(r -> r.get("id").asString()).doesNotHaveDuplicates();
        assertThat(authors.size()).isGreaterThanOrEqualTo(8);
        List<JsonNode> members = walk("/api/v1/members?limit=2", data.librarian(), new ArrayList<>());
        assertThat(members).extracting(r -> r.get("id").asString()).doesNotHaveDuplicates();
    }

    @Test
    void limitsAndCursorsAreValidated() {
        String garbageJson = Base64.getUrlEncoder().withoutPadding().encodeToString("hello world".getBytes());
        for (String query : List.of("limit=0", "limit=101", "limit=-1", "limit=ten", "limit=2.5",
                "cursor=this-is-not-a-cursor", "cursor=" + garbageJson, "cursor=%25%25%25", "sort=isbn")) {
            Api.Response response = api.get("/api/v1/books?" + query).send();
            assertThat(response.status()).as(query).isEqualTo(400);
            assertThat(response.code()).isEqualTo("validation-failed");
            assertThat(response.text("instance")).isEqualTo("/api/v1/books");
        }
        JsonNode defaults = api.get("/api/v1/authors").send().json();
        assertThat(defaults.get("page").get("limit").asInt()).isEqualTo(20);
    }

    @Test
    void aCursorFromOneSortCannotBeUsedWithAnother() {
        String tag = tag();
        for (int i = 0; i < 3; i++) {
            data.book("Sort " + i, 0, List.of(tag));
        }
        String cursor = api.get("/api/v1/books?limit=1&tag=" + tag).send().json().get("page").get("nextCursor").asString();
        Api.Response mismatch = api.get("/api/v1/books?limit=1&sort=-publishedYear&tag=" + tag + "&cursor=" + cursor).send();
        assertThat(mismatch.status()).isEqualTo(400);
    }
}
