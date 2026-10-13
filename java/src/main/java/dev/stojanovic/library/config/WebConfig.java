package dev.stojanovic.library.config;

import dev.stojanovic.library.adapters.in.web.filter.AccessLogFilter;
import dev.stojanovic.library.adapters.in.web.filter.DeprecationHeadersFilter;
import dev.stojanovic.library.adapters.in.web.filter.RateLimitFilter;
import dev.stojanovic.library.adapters.in.web.filter.RequestIdFilter;
import dev.stojanovic.library.adapters.in.web.support.ActorArgumentResolver;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import dev.stojanovic.library.application.service.RateLimitService;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * Servlet filters, outermost first. All run before Spring Security (order -100), so request ids, access logs,
 * deprecation and rate-limit headers also apply to 401/403 responses.
 */
@Configuration(proxyBeanMethods = false)
class WebConfig implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new ActorArgumentResolver());
    }

    @Bean
    FilterRegistrationBean<RequestIdFilter> requestIdFilter() {
        return register(new RequestIdFilter(), Ordered.HIGHEST_PRECEDENCE);
    }

    @Bean
    FilterRegistrationBean<AccessLogFilter> accessLogFilter() {
        return register(new AccessLogFilter(), Ordered.HIGHEST_PRECEDENCE + 10);
    }

    @Bean
    FilterRegistrationBean<DeprecationHeadersFilter> deprecationHeadersFilter() {
        return register(new DeprecationHeadersFilter(), Ordered.HIGHEST_PRECEDENCE + 20);
    }

    @Bean
    FilterRegistrationBean<RateLimitFilter> rateLimitFilter(RateLimitService limiter, JwtDecoder decoder,
                                                            Problems problems) {
        return register(new RateLimitFilter(limiter, decoder, problems), Ordered.HIGHEST_PRECEDENCE + 30);
    }

    private static <F extends jakarta.servlet.Filter> FilterRegistrationBean<F> register(F filter, int order) {
        FilterRegistrationBean<F> registration = new FilterRegistrationBean<>(filter);
        registration.setOrder(order);
        return registration;
    }
}
