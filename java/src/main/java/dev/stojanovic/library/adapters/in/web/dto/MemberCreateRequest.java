package dev.stojanovic.library.adapters.in.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record MemberCreateRequest(
        @NotNull @Email @Size(max = 254) String email,
        @NotNull @Size(min = 1, max = 200) String name,
        @NotNull @Size(min = 10, max = 72) String password,
        @Min(1) @Max(10) Integer maxActiveLoans) {
}
