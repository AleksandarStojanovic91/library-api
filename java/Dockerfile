# syntax=docker/dockerfile:1.7
# Build context is the repository root (see docker-compose.yml), because the build needs the shared
# contract/openapi.yaml and db/migrations next to this module.

# ---- build ---------------------------------------------------------------------------------------
FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /workspace/java

# Dependencies first, so source changes do not invalidate the (slow) dependency layer.
COPY java/.mvn/ .mvn/
COPY java/mvnw java/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -q dependency:go-offline

COPY contract/openapi.yaml /workspace/contract/openapi.yaml
COPY db/migrations/ /workspace/db/migrations/
COPY java/src/ src/
# Tests run in CI (./mvnw verify with Testcontainers); the image build only packages.
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -q -DskipTests package \
 && java -Djarmode=tools -jar target/library-api-1.0.0.jar extract --layers --launcher --destination target/extracted

# ---- runtime -------------------------------------------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime
RUN addgroup -S library && adduser -S -G library -H -s /sbin/nologin library
WORKDIR /app

# Layers from least to most frequently changing, so a code change only ships the small last layer.
COPY --from=build --chown=library:library /workspace/java/target/extracted/dependencies/ ./
COPY --from=build --chown=library:library /workspace/java/target/extracted/spring-boot-loader/ ./
COPY --from=build --chown=library:library /workspace/java/target/extracted/snapshot-dependencies/ ./
COPY --from=build --chown=library:library /workspace/java/target/extracted/application/ ./

USER library
ENV PORT=8081 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:InitialRAMPercentage=50 -XX:+ExitOnOutOfMemoryError -XX:+UseG1GC -Djava.security.egd=file:/dev/urandom"
EXPOSE 8081

# Readiness, not liveness: Docker only uses this for status and depends_on; DB down -> unhealthy.
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/ready" || exit 1

# exec form: the JVM is PID 1 and receives SIGTERM directly, which starts Spring's graceful shutdown
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
