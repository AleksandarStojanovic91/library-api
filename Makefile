# Common tasks. `make help` lists them.
# The stack runs with docker-compose.test.yml on top, which raises the rate limit so the parallel test suite
# and k6 do not trip it (plain `docker compose up` keeps the default 120 requests/minute).

COMPOSE   := docker compose -f docker-compose.yml -f docker-compose.test.yml
K6_IMAGE  := grafana/k6:2.3.0
K6        := docker run --rm -i --network host --user $$(id -u):$$(id -g) -v "$(CURDIR)":/work -w /work $(K6_IMAGE)
JAVA_URL  := http://localhost:8081
TS_URL    := http://localhost:8082

.PHONY: help up down logs ps wait test-java test-ts api-install api-types api-typecheck \
        api-test-java api-test-ts api-test-time-travel-java api-test-time-travel-ts \
        perf-smoke perf-load lint-contract

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-28s %s\n", $$1, $$2}'

up: ## Build and start postgres, redis and both implementations, wait until ready
	$(COMPOSE) up -d --build postgres redis api-java api-ts
	@$(MAKE) --no-print-directory wait URLS="$(JAVA_URL) $(TS_URL)"

down: ## Stop everything and delete the database volume
	$(COMPOSE) --profile time-travel --profile obs down -v

logs: ## Follow the service logs
	$(COMPOSE) logs -f api-java api-ts

ps: ## Show running containers
	$(COMPOSE) --profile time-travel ps

wait: ## Wait for /health/ready on URLS (internal)
	@for url in $(URLS); do \
	  printf 'waiting for %s ' $$url; \
	  for i in $$(seq 1 90); do curl -fsS $$url/health/ready >/dev/null 2>&1 && break; printf .; sleep 2; done; \
	  curl -fsS $$url/health/ready >/dev/null || { echo ' not ready'; exit 1; }; echo ' ready'; \
	done

test-java: ## Unit and integration tests of the Java service (mvn verify)
	cd java && ./mvnw -B verify

test-ts: ## Lint, typecheck and tests of the TypeScript service
	cd ts && npm ci && npm run lint && npm run typecheck && npm test

api-install: ## Install the shared API test suite
	cd api-tests && npm ci

api-types: ## Regenerate TypeScript types from contract/openapi.yaml
	cd api-tests && npm run generate

api-typecheck: ## Typecheck the shared suite and run its offline self-tests
	cd api-tests && npm run typecheck && npx playwright test --project=unit

api-test-java: ## Run the shared black-box suite against the Java service (:8081)
	cd api-tests && npx playwright test --project=java

api-test-ts: ## Run the shared black-box suite against the TypeScript service (:8082)
	cd api-tests && npx playwright test --project=ts

api-test-time-travel-java: ## Start the Java time-travel instance (:8091) and run the overdue/expiry tests
	$(COMPOSE) up -d --build api-java-future
	@$(MAKE) --no-print-directory wait URLS=http://localhost:8091
	cd api-tests && OVERDUE_BASE_URL=http://localhost:8091 npx playwright test --project=java-time-travel

api-test-time-travel-ts: ## Start the TypeScript time-travel instance (:8092) and run the overdue/expiry tests
	$(COMPOSE) up -d --build api-ts-future
	@$(MAKE) --no-print-directory wait URLS=http://localhost:8092
	cd api-tests && OVERDUE_BASE_URL=http://localhost:8092 npx playwright test --project=ts-time-travel

perf-smoke: ## k6 smoke test (1 VU, 30 s) against both implementations
	$(K6) run -e BASE_URL=$(JAVA_URL) -e IMPL=java perf/smoke.js
	$(K6) run -e BASE_URL=$(TS_URL) -e IMPL=ts perf/smoke.js

perf-load: ## k6 load test against IMPL=java|ts (default java); SCALE=2 doubles the rates
	$(K6) run -e BASE_URL=$(if $(filter ts,$(IMPL)),$(TS_URL),$(JAVA_URL)) -e IMPL=$(or $(IMPL),java) -e SCALE=$(or $(SCALE),1) perf/load.js

lint-contract: ## Lint contract/openapi.yaml with Redocly CLI
	npx --yes @redocly/cli@2.63.0 lint contract/openapi.yaml
