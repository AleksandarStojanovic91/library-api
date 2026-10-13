package dev.stojanovic.library.adapters.in.web.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record LoanCreateRequest(@NotNull UUID bookId, UUID memberId) {
}
