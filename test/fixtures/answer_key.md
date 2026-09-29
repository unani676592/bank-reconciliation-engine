# Answer Key: Planted Problems

With the v2 date-tolerance rules (default window 3 days), your automation should
catch these **9 problems**. Every other row should come out as "Matched" — and
TXB-2003 is now one of them (see below).

| # | tx_id | Problem type | Severity | Details |
|---|-------|--------------|----------|---------|
| 1 | TXA-1007 | Missing in Ledger | Error | In Bank A (-2,499 to CloudDesk Software) but not recorded in the ledger |
| 2 | TXB-2012 | Missing in Ledger | Error | In Bank B (-1,500 bank charges) but not recorded in the ledger |
| 3 | TXL-9001 | Missing in Bank | Error | In ledger (-18,500 to Printwell Press) but not in either bank |
| 4 | TXL-9002 | Missing in Bank | Error | In ledger (+35,000 from Greenleaf Foods) but money never arrived in either bank |
| 5 | TXA-1004 | Amount Mismatch | Error | Bank A says -5,500, ledger says -5,000 |
| 6 | TXB-2009 | Amount Mismatch | Error | Bank B says -12,750, ledger says -12,570 (digits swapped, a common typo) |
| 7 | TXA-1011 | Duplicate | Error | Appears twice in Bank A |
| 8 | TXB-2005 | Duplicate | Error | Appears twice in the ledger |
| 9 | TXA-1006 | Name Mismatch | Warning | Bank A says "Rahul Verma", ledger says "Rohit Verma". Same ID and amount. |

**No longer a problem:** TXB-2003 (Bank B 2026-09-03, ledger 2026-09-02, same
amount) is a 1-day posting lag. That is within the 3-day tolerance window, so it
comes out **Matched** with the note "posted 1 day late" and `days_diff` 1.

## Columns in every file
tx_id, date, party_name, amount, description

## Security rule
No file contains account numbers, IFSC codes, card numbers, or balances. The automation matches only on tx_id, with party_name as a second check. If a real bank export ever includes sensitive columns, the first node in the workflow must drop them before anything else runs.

## Notes
- Amounts are in rupees. Negative = money going out, positive = money coming in.
- Bank A IDs start with TXA, Bank B with TXB, ledger-only entries with TXL.
- Row counts: Bank A 16, Bank B 15, Ledger 31. Total unique tx_ids: 32.
- Date tolerance: a bank often posts a day or two after the company records the
  entry. The v2 engine treats a gap within the window (default 3 days) as Matched
  with a note; a gap larger than the window is a Warning.
