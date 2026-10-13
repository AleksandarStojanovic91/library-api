package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.MemberCredentials;
import dev.stojanovic.library.application.model.MemberView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.domain.model.Member;
import dev.stojanovic.library.domain.model.MemberStatus;

import java.util.Optional;
import java.util.UUID;

public interface MemberRepository {

    Optional<Member> findById(UUID id);

    /** {@code SELECT ... FOR UPDATE}: serialises one member's borrows so the loan limit cannot be raced. */
    Optional<Member> lockById(UUID id);

    Optional<MemberCredentials> findCredentialsByEmail(String email);

    Optional<MemberView> findView(UUID id);

    Page<MemberView> list(PageRequest page);

    /** Sets status and, when given, the loan limit; false if the member does not exist. */
    boolean updateStatus(UUID id, MemberStatus status, Integer maxActiveLoans);

    /** A duplicate e-mail (case-insensitive) is a {@code DUPLICATE} failure. */
    UUID insert(String email, String name, String passwordHash, int maxActiveLoans);
}
