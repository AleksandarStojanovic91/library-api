package dev.stojanovic.library.application.port.out;

public interface HealthProbe {

    String name();

    /** Whether the service can work without this dependency (degraded but ready). */
    boolean optional();

    boolean isUp();
}
