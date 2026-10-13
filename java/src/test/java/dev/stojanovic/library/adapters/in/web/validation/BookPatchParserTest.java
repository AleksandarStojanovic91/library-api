package dev.stojanovic.library.adapters.in.web.validation;

import dev.stojanovic.library.domain.error.FieldViolation;
import dev.stojanovic.library.domain.error.ValidationException;
import dev.stojanovic.library.domain.model.BookPatch;
import dev.stojanovic.library.domain.model.Patch;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookPatchParserTest {

    private final JsonMapper json = JsonMapper.builder().build();

    private BookPatch parse(String body) {
        return BookPatchParser.parse(json.readTree(body));
    }

    private List<FieldViolation> violations(String body) {
        try {
            parse(body);
        } catch (ValidationException e) {
            return e.violations();
        }
        throw new AssertionError("expected a validation error for " + body);
    }

    @Test
    void distinguishesAbsentFromNull() {
        BookPatch patch = parse("{\"description\": null, \"title\": \"New\"}");
        assertThat(patch.description()).isEqualTo(Patch.of(null));
        assertThat(patch.title()).isEqualTo(Patch.of("New"));
        assertThat(patch.publishedYear().isPresent()).isFalse();
        assertThat(patch.authorIds().isPresent()).isFalse();
    }

    @Test
    void parsesListsAndYear() {
        UUID author = UUID.randomUUID();
        BookPatch patch = parse("{\"authorIds\": [\"" + author + "\"], \"tags\": [], \"publishedYear\": 1999}");
        assertThat(patch.authorIds()).isEqualTo(Patch.of(List.of(author)));
        assertThat(patch.tags()).isEqualTo(Patch.of(List.of()));
        assertThat(patch.publishedYear()).isEqualTo(Patch.of(1999));
    }

    @Test
    void reportsEveryFailingField() {
        assertThat(violations("""
                {"title": null, "publishedYear": 1200, "authorIds": ["nope", "nope"], "tags": ["", 5], "isbn": "x"}"""))
                .extracting(FieldViolation::field)
                .containsExactlyInAnyOrder("isbn", "title", "publishedYear", "authorIds.0", "authorIds.1", "authorIds",
                        "tags.0", "tags.1");
    }

    @Test
    void emptyListOfAuthorsIsInvalid() {
        assertThat(violations("{\"authorIds\": []}")).extracting(FieldViolation::field).containsExactly("authorIds");
    }

    @Test
    void bodyMustBeANonEmptyObject() {
        assertThatThrownBy(() -> parse("{}")).isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> parse("[]")).isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> parse("\"title\"")).isInstanceOf(ValidationException.class);
    }

    @Test
    void numbersAreNotStrings() {
        assertThat(violations("{\"title\": 42, \"publishedYear\": \"1999\"}")).extracting(FieldViolation::field)
                .containsExactlyInAnyOrder("title", "publishedYear");
    }
}
