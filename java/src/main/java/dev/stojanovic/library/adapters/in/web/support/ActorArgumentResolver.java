package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.domain.model.Actor;
import dev.stojanovic.library.domain.model.Role;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;

/** Lets controllers declare an {@link Actor} parameter instead of digging through Spring Security types. */
public class ActorArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return Actor.class.equals(parameter.getParameterType());
    }

    @Override
    public Actor resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                 NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken token) {
            return new Actor(UUID.fromString(token.getName()), Role.valueOf(token.getToken().getClaimAsString("role")));
        }
        // Only reachable on public routes; protected routes are guarded by the security filter chain.
        throw new IllegalStateException("No authenticated member for " + parameter.getMethod());
    }
}
