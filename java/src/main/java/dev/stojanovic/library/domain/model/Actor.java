package dev.stojanovic.library.domain.model;

import java.util.Objects;
import java.util.UUID;

/** The authenticated caller, as far as business rules are concerned. */
public record Actor(UUID memberId, Role role) {

    public Actor {
        Objects.requireNonNull(memberId, "memberId");
        Objects.requireNonNull(role, "role");
    }

    public boolean isLibrarian() {
        return role == Role.LIBRARIAN;
    }

    /** Librarians see everything; members only what they own. */
    public boolean mayAccess(UUID ownerId) {
        return isLibrarian() || memberId.equals(ownerId);
    }
}
