package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.CopyView;
import dev.stojanovic.library.domain.model.CopyStatus;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CopyRepository {

    List<CopyView> listByBook(UUID bookId);

    /** A duplicate barcode is a {@code DUPLICATE} failure. */
    CopyView insert(UUID bookId, String barcode);

    /**
     * Locks one AVAILABLE copy of the book, skipping copies other transactions have locked: parallel borrows never
     * get the same copy and never wait for each other.
     */
    Optional<UUID> claimAvailable(UUID bookId);

    boolean anyAvailable(UUID bookId);

    void updateStatus(UUID copyId, CopyStatus status);
}
