package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.TokenRequest;
import dev.stojanovic.library.adapters.in.web.dto.TokenResponse;
import dev.stojanovic.library.application.model.IssuedToken;
import dev.stojanovic.library.application.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
class AuthController {

    private final AuthService auth;

    AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/token")
    TokenResponse issueToken(@Valid @RequestBody TokenRequest request) {
        IssuedToken token = auth.issueToken(request.email(), request.password());
        return new TokenResponse(token.accessToken(), "Bearer", token.expiresInSeconds());
    }
}
