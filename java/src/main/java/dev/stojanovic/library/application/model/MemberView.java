package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.MemberStatus;
import dev.stojanovic.library.domain.model.Role;

import java.time.Instant;
import java.util.UUID;

public record MemberView(UUID id, String email, String name, Role role, MemberStatus status, int maxActiveLoans,
                         int activeLoans, Instant createdAt) {
}
