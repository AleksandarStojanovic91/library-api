package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.IssuedToken;
import dev.stojanovic.library.application.model.MemberCredentials;

public interface TokenIssuer {

    IssuedToken issue(MemberCredentials member);
}
