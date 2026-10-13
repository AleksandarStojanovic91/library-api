package dev.stojanovic.library.adapters.out.persistence;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Collects optional SQL conditions and their named parameters; conditions are fixed strings, values are bound. */
final class Where {

    private final List<String> conditions = new ArrayList<>();
    private final Map<String, Object> params = new LinkedHashMap<>();

    Where and(String condition) {
        conditions.add(condition);
        return this;
    }

    Where param(String name, Object value) {
        params.put(name, value);
        return this;
    }

    String sql() {
        return conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
    }

    Map<String, Object> params() {
        return params;
    }
}
