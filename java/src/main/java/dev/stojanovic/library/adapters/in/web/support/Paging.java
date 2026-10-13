package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import org.springframework.stereotype.Component;

import java.util.function.Function;

@Component
public class Paging {

    private final CursorCodec cursors;

    public Paging(CursorCodec cursors) {
        this.cursors = cursors;
    }

    /** {@code limit} range is enforced by bean validation on the controller parameter. */
    public PageRequest request(Integer limit, String cursor) {
        return new PageRequest(limit == null ? PageRequest.DEFAULT_LIMIT : limit, cursors.decode(cursor));
    }

    public <T, R> PageResponse<R> response(Page<T> page, PageRequest request, Function<T, R> mapper) {
        return new PageResponse<>(page.items().stream().map(mapper).toList(),
                new PageResponse.PageInfo(request.limit(), cursors.encode(page.next())));
    }
}
