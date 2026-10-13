package dev.stojanovic.library.application;

import dev.stojanovic.library.application.page.Cursor;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.domain.error.ValidationException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CursorTest {

    @Test
    void typedGettersParseWhatWasStored() {
        UUID id = UUID.randomUUID();
        Instant micros = Instant.parse("2026-10-13T09:15:00.123456Z");
        Cursor cursor = Cursor.of("c", micros.toString(), "id", id.toString(), "y", null, "r", "0.0607927");
        assertThat(cursor.uuid("id")).isEqualTo(id);
        assertThat(cursor.instant("c")).isEqualTo(micros); // keeps microseconds, unlike the API's timestamps
        assertThat(cursor.nullableInt("y")).isNull();
        assertThat(cursor.floatValue("r")).isEqualTo(0.0607927f);
    }

    @Test
    void tamperedValuesAreValidationErrorsOnTheCursorField() {
        Cursor cursor = Cursor.of("id", "not-a-uuid", "c", "yesterday", "r", "NaN");
        for (Runnable read : List.<Runnable>of(() -> cursor.uuid("id"), () -> cursor.instant("c"),
                () -> cursor.floatValue("r"), () -> cursor.string("missing"))) {
            assertThatThrownBy(read::run).isInstanceOfSatisfying(ValidationException.class,
                    e -> assertThat(e.violations()).singleElement().satisfies(v -> assertThat(v.field()).isEqualTo("cursor")));
        }
    }

    @Test
    void overfetchDecidesWhetherThereIsANextPage() {
        PageRequest request = new PageRequest(2, null);
        Page<Integer> last = Page.fromOverfetch(List.of(1, 2), request, i -> Cursor.of("k", i.toString()));
        assertThat(last.next()).isNull();

        Page<Integer> more = Page.fromOverfetch(List.of(1, 2, 3), request, i -> Cursor.of("k", i.toString()));
        assertThat(more.items()).containsExactly(1, 2);
        assertThat(more.next().string("k")).isEqualTo("2"); // keyed on the last row returned, not the extra one
    }

    @Test
    void limitMustBeWithinOneAndHundred() {
        assertThatThrownBy(() -> new PageRequest(0, null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PageRequest(101, null)).isInstanceOf(IllegalArgumentException.class);
        assertThat(new PageRequest(100, null).fetchSize()).isEqualTo(101);
    }
}
