package dev.stojanovic.library.domain;

import dev.stojanovic.library.domain.model.Book;
import dev.stojanovic.library.domain.model.BookPatch;
import dev.stojanovic.library.domain.model.Patch;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BookTest {

    private final UUID author = UUID.randomUUID();
    private final Book book = new Book(UUID.randomUUID(), "9780132350884", "Clean Code", "A handbook", 2008,
            List.of("software"), List.of(author), 3);

    @Test
    void absentFieldsStayAndNullClears() {
        Book patched = book.apply(new BookPatch(Patch.absent(), Patch.of(null), Patch.absent(), Patch.absent(),
                Patch.of(List.of("a", "b"))));
        assertThat(patched.title()).isEqualTo("Clean Code");
        assertThat(patched.description()).isNull();
        assertThat(patched.publishedYear()).isEqualTo(2008);
        assertThat(patched.tags()).containsExactly("a", "b");
        assertThat(patched.authorIds()).containsExactly(author);
        assertThat(patched.version()).isEqualTo(3);
        assertThat(patched.isbn()).isEqualTo(book.isbn());
    }

    @Test
    void authorListIsReplacedNotMerged() {
        UUID other = UUID.randomUUID();
        Book patched = book.apply(new BookPatch(Patch.of("Clean Code 2"), Patch.absent(), Patch.of(null),
                Patch.of(List.of(other)), Patch.absent()));
        assertThat(patched.authorIds()).containsExactly(other);
        assertThat(patched.title()).isEqualTo("Clean Code 2");
        assertThat(patched.publishedYear()).isNull();
    }
}
