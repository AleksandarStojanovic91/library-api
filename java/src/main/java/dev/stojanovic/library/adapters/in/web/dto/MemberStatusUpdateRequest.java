package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.domain.model.MemberStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record MemberStatusUpdateRequest(@NotNull MemberStatus status, @Min(1) @Max(10) Integer maxActiveLoans) {
}
