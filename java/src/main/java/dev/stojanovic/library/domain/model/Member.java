package dev.stojanovic.library.domain.model;

import java.time.Instant;
import java.util.UUID;

public record Member(UUID id, String email, String name, Role role, MemberStatus status, int maxActiveLoans,
                     Instant createdAt) {

    public boolean isSuspended() {
        return status == MemberStatus.SUSPENDED;
    }
}
