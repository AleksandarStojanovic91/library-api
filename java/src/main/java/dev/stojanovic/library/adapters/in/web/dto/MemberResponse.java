package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.MemberView;
import dev.stojanovic.library.domain.model.MemberStatus;
import dev.stojanovic.library.domain.model.Role;

import java.time.Instant;
import java.util.UUID;

public record MemberResponse(UUID id, String email, String name, Role role, MemberStatus status, int maxActiveLoans,
                             int activeLoans, Instant createdAt) {

    public static MemberResponse from(MemberView m) {
        return new MemberResponse(m.id(), m.email(), m.name(), m.role(), m.status(), m.maxActiveLoans(),
                m.activeLoans(), m.createdAt());
    }
}
