package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.MemberView;
import dev.stojanovic.library.application.model.NewMember;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.MemberRepository;
import dev.stojanovic.library.application.port.out.PasswordHasher;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Actor;
import dev.stojanovic.library.domain.model.MemberStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class MemberService {

    private final MemberRepository members;
    private final PasswordHasher passwords;

    public MemberService(MemberRepository members, PasswordHasher passwords) {
        this.members = members;
        this.passwords = passwords;
    }

    @Transactional(readOnly = true)
    public MemberView me(Actor actor) {
        return members.findView(actor.memberId()).orElseThrow(() -> LibraryException.notFound("Member"));
    }

    /** Another member's record is reported as missing, not forbidden, so ids cannot be probed. */
    @Transactional(readOnly = true)
    public MemberView get(Actor actor, UUID memberId) {
        if (!actor.mayAccess(memberId)) {
            throw LibraryException.notFound("Member");
        }
        return members.findView(memberId).orElseThrow(() -> LibraryException.notFound("Member"));
    }

    @Transactional(readOnly = true)
    public Page<MemberView> list(PageRequest page) {
        return members.list(page);
    }

    /**
     * Suspends or reactivates a member, optionally changing the loan limit. Lowering the limit below the current
     * number of open loans is allowed: it only stops further borrowing.
     */
    @Transactional
    public MemberView updateStatus(UUID memberId, MemberStatus status, Integer maxActiveLoans) {
        if (!members.updateStatus(memberId, status, maxActiveLoans)) {
            throw LibraryException.notFound("Member");
        }
        return members.findView(memberId).orElseThrow();
    }

    @Transactional
    public MemberView register(NewMember member) {
        UUID id = members.insert(member.email(), member.name(), passwords.hash(member.password()),
                member.maxActiveLoans());
        return members.findView(id).orElseThrow();
    }
}
