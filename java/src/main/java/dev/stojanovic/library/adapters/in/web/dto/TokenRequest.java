package dev.stojanovic.library.adapters.in.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record TokenRequest(@NotNull @Email @Size(max = 254) String email,
                           @NotNull @Size(min = 1, max = 200) String password) {
}
