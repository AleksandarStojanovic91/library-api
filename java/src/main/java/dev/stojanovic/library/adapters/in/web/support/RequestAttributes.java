package dev.stojanovic.library.adapters.in.web.support;

import jakarta.servlet.http.HttpServletRequest;

/** Request attributes shared between the servlet filters, the controllers and the error handling. */
public final class RequestAttributes {

    public static final String REQUEST_ID = RequestAttributes.class.getName() + ".requestId";
    /** The verified token subject, when the request carried a valid bearer token. */
    public static final String MEMBER_ID = RequestAttributes.class.getName() + ".memberId";

    private RequestAttributes() {
    }

    public static String requestId(HttpServletRequest request) {
        return (String) request.getAttribute(REQUEST_ID);
    }

    public static String memberId(HttpServletRequest request) {
        return (String) request.getAttribute(MEMBER_ID);
    }
}
