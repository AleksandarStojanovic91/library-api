package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.MemberCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.MemberResponse;
import dev.stojanovic.library.adapters.in.web.dto.MemberStatusUpdateRequest;
import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.adapters.in.web.support.Paging;
import dev.stojanovic.library.application.model.MemberView;
import dev.stojanovic.library.application.model.NewMember;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.service.MemberService;
import dev.stojanovic.library.domain.model.Actor;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Objects;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/members")
class MemberController {

    private final MemberService members;
    private final Paging paging;

    MemberController(MemberService members, Paging paging) {
        this.members = members;
        this.paging = paging;
    }

    @GetMapping
    PageResponse<MemberResponse> list(@RequestParam(required = false) @Min(1) @Max(100) Integer limit,
                                      @RequestParam(required = false) @Size(max = 500) String cursor) {
        PageRequest page = paging.request(limit, cursor);
        return paging.response(members.list(page), page, MemberResponse::from);
    }

    @PostMapping
    ResponseEntity<MemberResponse> register(@Valid @RequestBody MemberCreateRequest request) {
        MemberView member = members.register(new NewMember(request.email(), request.name(), request.password(),
                Objects.requireNonNullElse(request.maxActiveLoans(), NewMember.DEFAULT_MAX_ACTIVE_LOANS)));
        return ResponseEntity.created(URI.create("/api/v1/members/" + member.id())).body(MemberResponse.from(member));
    }

    @GetMapping("/me")
    MemberResponse me(Actor actor) {
        return MemberResponse.from(members.me(actor));
    }

    @GetMapping("/{memberId}")
    MemberResponse get(Actor actor, @PathVariable UUID memberId) {
        return MemberResponse.from(members.get(actor, memberId));
    }

    @PutMapping("/{memberId}/status")
    MemberResponse updateStatus(@PathVariable UUID memberId, @Valid @RequestBody MemberStatusUpdateRequest request) {
        return MemberResponse.from(members.updateStatus(memberId, request.status(), request.maxActiveLoans()));
    }
}
