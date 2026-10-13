package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.AuthorView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface AuthorRepository {

    Page<AuthorView> list(PageRequest page);

    Optional<AuthorView> findById(UUID id);

    AuthorView insert(String name, String bio);

    /** The subset of {@code ids} that exist. */
    Set<UUID> existing(Collection<UUID> ids);
}
