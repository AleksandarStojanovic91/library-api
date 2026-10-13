package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.AuthorView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.AuthorRepository;
import dev.stojanovic.library.domain.error.LibraryException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class AuthorService {

    private final AuthorRepository authors;

    public AuthorService(AuthorRepository authors) {
        this.authors = authors;
    }

    @Transactional(readOnly = true)
    public Page<AuthorView> list(PageRequest page) {
        return authors.list(page);
    }

    @Transactional(readOnly = true)
    public AuthorView get(UUID id) {
        return authors.findById(id).orElseThrow(() -> LibraryException.notFound("Author"));
    }

    @Transactional
    public AuthorView create(String name, String bio) {
        return authors.insert(name, bio);
    }
}
