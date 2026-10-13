package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.Role;

import java.util.UUID;

public record MemberCredentials(UUID id, String email, Role role, String passwordHash) {
}
