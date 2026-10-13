package dev.stojanovic.library.adapters.in.web.dto;

import java.util.List;

public record PageResponse<T>(List<T> data, PageInfo page) {

    public record PageInfo(int limit, String nextCursor) {
    }
}
