package dev.stojanovic.library.application.page;

public record PageRequest(int limit, Cursor after) {

    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 100;

    public PageRequest {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new IllegalArgumentException("limit must be between 1 and " + MAX_LIMIT);
        }
    }

    /** Repositories fetch one extra row to learn whether another page exists, without a COUNT query. */
    public int fetchSize() {
        return limit + 1;
    }
}
