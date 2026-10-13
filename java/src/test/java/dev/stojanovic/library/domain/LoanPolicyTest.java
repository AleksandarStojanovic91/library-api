package dev.stojanovic.library.domain;

import dev.stojanovic.library.domain.model.Loan;
import dev.stojanovic.library.domain.model.LoanStatus;
import dev.stojanovic.library.domain.model.Money;
import dev.stojanovic.library.domain.policy.FeeCalculator;
import dev.stojanovic.library.domain.policy.LoanPolicy;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LoanPolicyTest {

    private static final Instant BORROWED = Instant.parse("2026-10-13T09:15:00.000Z");
    private final LoanPolicy policy = new LoanPolicy(Duration.ofDays(14), new FeeCalculator(50));

    private Loan openLoan() {
        return new Loan(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), BORROWED,
                policy.dueAt(BORROWED), null, null);
    }

    @Test
    void loanLastsFourteenDays() {
        assertThat(policy.dueAt(BORROWED)).isEqualTo(Instant.parse("2026-10-27T09:15:00.000Z"));
    }

    @ParameterizedTest
    @CsvSource({"0, 3, true", "2, 3, true", "3, 3, false", "4, 3, false", "0, 1, true", "1, 1, false"})
    void limitIsExclusive(int open, int max, boolean allowed) {
        assertThat(policy.mayBorrow(open, max)).isEqualTo(allowed);
    }

    @Nested
    class Status {

        @Test
        void activeUntilAndIncludingTheDueInstant() {
            Loan loan = openLoan();
            assertThat(loan.statusAt(BORROWED)).isEqualTo(LoanStatus.ACTIVE);
            assertThat(loan.statusAt(loan.dueAt())).isEqualTo(LoanStatus.ACTIVE);
        }

        @Test
        void overdueOneMillisecondAfterDue() {
            Loan loan = openLoan();
            assertThat(loan.statusAt(loan.dueAt().plusMillis(1))).isEqualTo(LoanStatus.OVERDUE);
        }

        @Test
        void returnedWinsOverDates() {
            Loan loan = openLoan();
            Loan returned = new Loan(loan.id(), loan.bookId(), loan.copyId(), loan.memberId(), loan.borrowedAt(),
                    loan.dueAt(), loan.dueAt().plus(Duration.ofDays(5)), 250);
            assertThat(returned.statusAt(loan.dueAt().plus(Duration.ofDays(30)))).isEqualTo(LoanStatus.RETURNED);
        }
    }

    @Nested
    class OverdueDaysAndFees {

        @Test
        void wholeDaysAreRoundedDownButFeesRoundUp() {
            Loan loan = openLoan();
            Instant now = loan.dueAt().plus(Duration.ofDays(2)).plusSeconds(1);
            assertThat(policy.overdueDays(loan, now)).isEqualTo(2);
            assertThat(policy.currentFee(loan, now)).contains(Money.eurCents(150));
        }

        @Test
        void notLateMeansZeroDaysAndNoFee() {
            Loan loan = openLoan();
            assertThat(policy.overdueDays(loan, loan.dueAt())).isZero();
            assertThat(policy.currentFee(loan, loan.dueAt())).isEmpty();
            assertThat(policy.feeOnReturn(loan, loan.dueAt())).isEmpty();
        }

        @Test
        void returnedLoanUsesStoredFeeAndReturnTime() {
            Loan loan = openLoan();
            Instant returnedAt = loan.dueAt().plus(Duration.ofDays(3));
            Loan returned = new Loan(loan.id(), loan.bookId(), loan.copyId(), loan.memberId(), loan.borrowedAt(),
                    loan.dueAt(), returnedAt, policy.feeOnReturn(loan, returnedAt).orElseThrow());
            Instant muchLater = returnedAt.plus(Duration.ofDays(100));
            assertThat(returned.feeCents()).isEqualTo(150);
            assertThat(policy.overdueDays(returned, muchLater)).isEqualTo(3);
            assertThat(policy.currentFee(returned, muchLater)).contains(Money.eurCents(150));
        }

        @Test
        void returnTimeNeverPrecedesBorrowTime() {
            Loan loan = openLoan();
            assertThat(policy.returnTime(loan, BORROWED.minusSeconds(3600))).isEqualTo(BORROWED);
            assertThat(policy.returnTime(loan, BORROWED.plusSeconds(60))).isEqualTo(BORROWED.plusSeconds(60));
        }
    }

    @Test
    void moneyHasTwoDecimals() {
        assertThat(Money.eurCents(150).amount()).isEqualTo("1.50");
        assertThat(Money.eurCents(5).amount()).isEqualTo("0.05");
        assertThat(Money.eurCents(12345).amount()).isEqualTo("123.45");
        assertThat(Money.eurCents(0).amount()).isEqualTo("0.00");
    }
}
