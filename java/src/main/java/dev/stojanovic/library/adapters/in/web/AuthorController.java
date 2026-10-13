package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.AuthorCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.AuthorResponse;
import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.adapters.in.web.support.Paging;
import dev.stojanovic.library.application.model.AuthorView;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.service.AuthorService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/authors")
class AuthorController {

    private final AuthorService authors;
    private final Paging paging;

    AuthorController(AuthorService authors, Paging paging) {
        this.authors = authors;
        this.paging = paging;
    }

    @GetMapping
    PageResponse<AuthorResponse> list(@RequestParam(required = false) @Min(1) @Max(100) Integer limit,
                                      @RequestParam(required = false) @Size(max = 500) String cursor) {
        PageRequest page = paging.request(limit, cursor);
        return paging.response(authors.list(page), page, AuthorResponse::from);
    }

    @PostMapping
    ResponseEntity<AuthorResponse> create(@Valid @RequestBody AuthorCreateRequest request) {
        AuthorView author = authors.create(request.name(), request.bio());
        return ResponseEntity.created(URI.create("/api/v1/authors/" + author.id())).body(AuthorResponse.from(author));
    }

    @GetMapping("/{authorId}")
    AuthorResponse get(@PathVariable UUID authorId) {
        return AuthorResponse.from(authors.get(authorId));
    }
}
