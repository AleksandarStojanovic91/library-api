package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AuthIT extends IntegrationTest {

    @Test
    void issuesAnHs256TokenWithTheSpecClaims() {
        Api.Response response = api.post("/api/v1/auth/token")
                .json(Map.of("email", "member@library.test", "password", "member-pass-123")).send();

        assertThat(response.status()).isEqualTo(200);
        assertThat(response.text("tokenType")).isEqualTo("Bearer");
        assertThat(response.json().get("expiresIn").asInt()).isEqualTo(3600);
        String[] parts = response.text("accessToken").split("\\.");
        JsonNode header = json.readTree(Base64.getUrlDecoder().decode(parts[0]));
        JsonNode claims = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
        assertThat(header.get("alg").asString()).isEqualTo("HS256");
        assertThat(claims.get("sub").asString()).isEqualTo(Fixtures.MEMBER_ID);
        assertThat(claims.get("role").asString()).isEqualTo("MEMBER");
        assertThat(claims.get("email").asString()).isEqualTo("member@library.test");
        assertThat(claims.get("iss").asString()).isEqualTo("library-api");
        assertThat(claims.get("exp").asLong() - claims.get("iat").asLong()).isEqualTo(3600);
    }

    @Test
    void wrongPasswordAndUnknownEmailAreIndistinguishable() {
        Api.Response wrongPassword = api.post("/api/v1/auth/token")
                .json(Map.of("email", "member@library.test", "password", "wrong-password")).send();
        Api.Response unknownEmail = api.post("/api/v1/auth/token")
                .json(Map.of("email", "nobody@library.test", "password", "wrong-password")).send();

        for (Api.Response r : new Api.Response[]{wrongPassword, unknownEmail}) {
            assertThat(r.status()).isEqualTo(401);
            assertThat(r.code()).isEqualTo("unauthorized");
            assertThat(r.header("WWW-Authenticate")).startsWith("Bearer");
        }
        assertThat(wrongPassword.text("detail")).isEqualTo(unknownEmail.text("detail"));
    }

    @Test
    void loginBodyIsValidatedAndClosed() {
        Api.Response empty = api.post("/api/v1/auth/token").json(Map.of()).send();
        assertThat(empty.status()).isEqualTo(400);
        assertThat(empty.json().get("errors").findValuesAsString("field")).contains("email", "password");

        Api.Response extra = api.post("/api/v1/auth/token")
                .json(Map.of("email", "member@library.test", "password", "member-pass-123", "role", "LIBRARIAN")).send();
        assertThat(extra.status()).isEqualTo(400);
        assertThat(extra.code()).isEqualTo("validation-failed");
    }

    @Test
    void protectedRoutesNeedAValidToken() {
        Api.Response missing = api.get("/api/v1/members/me").send();
        assertThat(missing.status()).isEqualTo(401);
        assertThat(missing.header("WWW-Authenticate")).isEqualTo("Bearer");

        Api.Response garbage = api.get("/api/v1/members/me").token("not-a-jwt").send();
        assertThat(garbage.status()).isEqualTo(401);

        String token = data.seededMember();
        String[] parts = token.split("\\.");
        String elevated = Base64.getUrlEncoder().withoutPadding().encodeToString(
                new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                        .replace("\"MEMBER\"", "\"LIBRARIAN\"").getBytes(StandardCharsets.UTF_8));
        Api.Response tampered = api.get("/api/v1/members").token(parts[0] + "." + elevated + "." + parts[2]).send();
        assertThat(tampered.status()).as("a forged role must fail signature checks, not reach authorization").isEqualTo(401);
    }

    @Test
    void memberCannotUseLibrarianRoutes() {
        Api.Response response = api.get("/api/v1/members").token(data.seededMember()).send();
        assertThat(response.status()).isEqualTo(403);
        assertThat(response.code()).isEqualTo("forbidden");
    }

    @Test
    void otherMembersRecordsAreNotFoundRatherThanForbidden() {
        Fixtures.Member owner = data.member();
        Fixtures.Member stranger = data.member();
        Fixtures.Book book = data.book(1);
        String loanId = data.borrow(owner.token(), book.id()).id();

        assertThat(api.get("/api/v1/members/" + owner.id()).token(stranger.token()).send().status()).isEqualTo(404);
        assertThat(api.get("/api/v1/members/" + owner.id()).token(owner.token()).send().status()).isEqualTo(200);
        assertThat(api.get("/api/v2/loans/" + loanId).token(stranger.token()).send().status()).isEqualTo(404);
        assertThat(api.get("/api/v1/loans/" + loanId).token(stranger.token()).send().status()).isEqualTo(404);
        assertThat(data.giveBack(stranger.token(), loanId).status()).isEqualTo(404);
        assertThat(api.get("/api/v2/loans/" + loanId).token(data.librarian()).send().status()).isEqualTo(200);
        assertThat(api.get("/api/v2/loans/" + loanId).token(owner.token()).send().text("status")).isEqualTo("ACTIVE");
    }

    @Test
    void membersCannotBorrowForOthersButLibrariansCan() {
        Fixtures.Member member = data.member();
        Fixtures.Member other = data.member();
        Fixtures.Book book = data.book(2);

        Api.Response forbidden = api.post("/api/v2/loans").token(member.token())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .json(Map.of("bookId", book.id(), "memberId", other.id())).send();
        assertThat(forbidden.status()).isEqualTo(403);

        Api.Response onBehalf = api.post("/api/v2/loans").token(data.librarian())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .json(Map.of("bookId", book.id(), "memberId", other.id())).send();
        assertThat(onBehalf.status()).isEqualTo(201);
        assertThat(onBehalf.text("memberId")).isEqualTo(other.id());
    }

    @Test
    void membersSeeOnlyTheirOwnListsEvenWhenAskingForSomeoneElse() {
        Fixtures.Member owner = data.member();
        Fixtures.Member stranger = data.member();
        Fixtures.Book book = data.book(2);
        data.borrow(owner.token(), book.id());
        data.borrow(stranger.token(), book.id());

        JsonNode list = api.get("/api/v2/loans?memberId=" + owner.id()).token(stranger.token()).send().json();
        assertThat(list.get("data").findValuesAsString("memberId")).containsOnly(stranger.id()).isNotEmpty();
    }

    @Test
    void librarianSuspendsAndReactivatesMembers() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(1);

        Api.Response suspended = api.put("/api/v1/members/" + member.id() + "/status").token(data.librarian())
                .json(Map.of("status", "SUSPENDED", "maxActiveLoans", 5)).send();
        assertThat(suspended.status()).isEqualTo(200);
        assertThat(suspended.text("status")).isEqualTo("SUSPENDED");
        assertThat(suspended.json().get("maxActiveLoans").asInt()).isEqualTo(5);

        assertThat(api.get("/api/v1/members/me").token(member.token()).send().status())
                .as("suspended members can still log in and read").isEqualTo(200);
        assertThat(data.borrow(member.token(), book.id()).code()).isEqualTo("member-suspended");
        assertThat(data.reserve(member.token(), book.id()).code()).isEqualTo("member-suspended");

        api.put("/api/v1/members/" + member.id() + "/status").token(data.librarian())
                .json(Map.of("status", "ACTIVE")).send();
        assertThat(data.borrow(member.token(), book.id()).status()).isEqualTo(201);

        assertThat(api.put("/api/v1/members/" + member.id() + "/status").token(member.token())
                .json(Map.of("status", "ACTIVE")).send().status()).isEqualTo(403);
        assertThat(api.put("/api/v1/members/" + Fixtures.MISSING_ID + "/status").token(data.librarian())
                .json(Map.of("status", "ACTIVE")).send().status()).isEqualTo(404);
    }
}
