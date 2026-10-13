package dev.stojanovic.library.application.page;

import java.util.List;
import java.util.function.Function;

/** A page of items plus the cursor of the next page, or {@code null} on the last page. */
public record Page<T>(List<T> items, Cursor next) {

    public Page {
        items = List.copyOf(items);
    }

    /** Trims a {@code limit + 1} result to {@code limit} rows and derives the next cursor from the last kept row. */
    public static <T> Page<T> fromOverfetch(List<T> rows, PageRequest request, Function<T, Cursor> cursorOf) {
        if (rows.size() <= request.limit()) {
            return new Page<>(rows, null);
        }
        List<T> kept = rows.subList(0, request.limit());
        return new Page<>(kept, cursorOf.apply(kept.getLast()));
    }

    public <R> Page<R> map(Function<T, R> mapper) {
        return new Page<>(items.stream().map(mapper).toList(), next);
    }
}
