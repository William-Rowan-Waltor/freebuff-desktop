# Recurring events — user guide

How repeating events behave across the app: the calendar, the editor, the
planner, the "Hôm nay" digest, and reminders. All UI strings are Vietnamese;
the English glosses below are for clarity.

## Creating a recurring event

- **Calendar quick-add** (`＋`): pick a repeat preset — **Không** (none),
  **Mỗi ngày** (daily), **Mỗi tuần** (weekly), **Mỗi tháng** (monthly),
  **Mỗi năm** (yearly), or **Số lần** (a fixed number of occurrences).
  `Số lần` opens a small form (frequency + count) and shows a live preview of
  how many occurrences result and when the last one falls
  (e.g. `4 lần mỗi tuần · lần cuối 18/09`).
- **Editor** (`RecurrencePicker`): same choices plus an end condition — no end,
  **Đến ngày** (until a date), or **Số lần** (a count). Until and count are
  mutually exclusive; picking one clears the other.

A recurrence rule is stored as an RFC-5545 string on the master block, e.g.
`FREQ=WEEKLY;BYDAY=FR` (every Friday), `FREQ=DAILY`, `FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1`
(last Friday of the month), or `FREQ=WEEKLY;COUNT=4` (exactly four times).

The **master** block is the stored block that holds the rule. Occurrences are
**virtual** — they are expanded on demand (calendar, planner, digest,
reminders) and are never stored as rows.

## Editing: this vs all

When you edit a recurring event (change the title, start/end time, or the
rule) you are asked **"Áp dụng thay đổi cho lần này hay tất cả các lần?"**:

| Action | Meaning |
|---|---|
| **Chỉ lần này** | Edit only the clicked occurrence. The occurrence is added to the master's **exception list**, and a **new one-off block** (a *this-occurrence override*) is created with the patched values, linked to the master as `attached`. Past overrides are carried into the series. |
| **Tất cả các lần** | Shift the whole series: the master's own start time is patched. |
| **Tất cả các lần sau lần này** | **Split** the series at this occurrence — see below. |

## This-and-future split

**"Tất cả các lần sau lần này"** cuts the series in two at the edited
occurrence:

- The **old master** keeps every occurrence **before** the split (those are
  excluded for the split point onward) and keeps its pre-split exceptions.
- A **new recurring master** is created with the same rule and the patched
  times, linked to the old master as `attached`. Occurrences from the split
  point onward now belong to the new master.
- **This-occurrence overrides** (blocks created with "Chỉ lần này") whose
  occurrence is at/after the split are **re-linked** to the new master, so they
  keep working without duplicating logic. Overrides before the split stay on
  the old master.

### Dead-master case

If the split point is **at or before the series' original start**, the old
master would be left with zero occurrences (a full exclusion list, hidden
forever). In that case the old master is **deleted** instead: the new master
takes over the entire series, and **all** of the old master's overrides are
re-linked to it first (so nothing is orphaned). This is equivalent to "all
instances" with a fresh start time.

## Exceptions ("Lần đã loại trừ")

Excluding an occurrence (edit "Chỉ lần này", or **Xóa lần này** in the
calendar/planner delete flow) records an entry on the master's
`recurrence_exceptions` list:

- **Timed** series store the occurrence's ISO instant.
- **All-day** series store the date-only `YYYY-MM-DD`.

The editor shows an **exception manager** listing excluded occurrences with a
**restore** action; restoring an occurrence removes it from the list, so the
series shows it again.

## Deleting

- Deleting a **plain** (non-recurring) block removes it directly.
- Deleting an **occurrence of a recurring series** holds behind the choice
  modal: **Xóa lần này** (exclude just this occurrence), **Xóa tất cả các lần
  sau lần này** (exclude every occurrence from that point onward — the same
  this-and-future logic as the editor split), or **Xóa tất cả các lần** (delete
  the master and the whole series).
- Deleting the **master** removes the whole series and **cascades to its
  this-occurrence overrides**, too: the non-recurring `attached` children are
  deleted along with the master, and every relation touching a removed block is
  dropped. **Split-series masters** (themselves recurring) are their own series
  and are NOT cascade-deleted — but deleting the old master orphans their
  relation, since the split series is its own root now.

### Undo ("Hoàn tác")

Row deletes are **soft by default**: the row is tombstoned (`deleted_at`) when
the live schema has the migration, and the db layer hides soft-deleted rows
(best-effort `purgeDeletedBlocks(7)` cleans tombstones past the one-week undo
window). Before the migration exists, deletes fall back to removing the row
outright. Either way, deleting one block (or cascading a master) snapshots the
removed blocks, their relations, and the storage paths of any deleted uploads.

A bottom banner appears with **Hoàn tác**: it **restores the exact rows and
relations** the delete removed — clearing the tombstone (soft mode) or
re-creating the row with its **original id** (hard mode), so relations still
reference it. Concurrent adds since the delete are preserved. Uploaded **file
bytes cannot be restored** — they are deleted immediately and the banner warns
("N tệp đính kèm không thể khôi phục"). The snapshot is persisted to
localStorage, so the banner survives a reload, and the **X** dismisses it.

## .ics export / import

### Export ("Xuất .ics")

The editor downloads the series as an `.ics` file: the master **plus every
exception** (`EXDATE`), any split continuations, and this-occurrence overrides.
Overrides and continuations are child `VEVENT`s that carry an
**`X-FREEBUFF-PARENT:<master-uid>`** property so the import can rebuild the
exact `attached` relation. A continuation's children hang off the continuation
(not the root master) — each child carries its own parent's uid.

### Import ("Nhập .ics")

Pasting/selecting an `.ics` file recreates the workspace:
- **Masters** (VEVENT with `RRULE`).
- **Split continuations** — recurring children whose `X-FREEBUFF-PARENT`
  points at a master; they get their own `attached` relation to it.
- **This-occurrence overrides** — one-off (no `RRULE`) children; relinked
  exactly via `X-FREEBUFF-PARENT`.

Parsing handles UTC, offset and floating times, `VALUE=DATE` all-day events,
folded lines, `EXDATE` lists, and date-only `UNTIL` values (rewritten to
end-of-day). External files without the marker use a **fallback heuristic**: a
one-off at an instant the master already excludes becomes an override; anything
else lands as a standalone event. A status message reports how many events were
imported.

## COUNT (bounded series)

`COUNT=` rules end the series after exactly N occurrences (including the
first). The last occurrence's date is shown in the quick-add preview. `COUNT`
and `UNTIL` are mutually exclusive — a rule can't have both.

## Timezone behavior

### Why timed events drift across DST

A timed series is anchored to the **UTC instant** stored in the master's
`start_time` (e.g. `2026-01-05T07:00:00Z`), and occurrences are expanded by
adding fixed increments to that instant (7 days = `+168h`, not "same
wall-clock next week"). The wall-clock label you see is just that instant
rendered in your local zone. When daylight saving changes your zone's offset
from UTC (e.g. `+01:00` → `+02:00`), the *same instant* now maps to a
different local time, so a 07:00 UTC event that displayed as `08:00` local in
winter displays as `09:00` after spring-forward — even though it has never
moved from `07:00 UTC`. Keeping the instant fixed is deliberate: the series
never skips or repeats an hour, and every device agrees on when the event
happens, at the cost of the wall-clock drift.

### Why all-day events don't drift

An all-day event stores a **date-only calendar day** (`YYYY-MM-DD`) — a date,
not an instant. There is no UTC anchor to shift, so the occurrence is
"2026-03-08 everywhere" no matter what the local offset is. (PostgREST
normalizes the date to a UTC-midnight instant on the DB round-trip; the app
recognizes that shape and re-reads it as the same **local calendar day** —
labels render `T3 11/08` with no clock time, horizon bucketing and end-of-day
visibility use the stored calendar day, so a negative-offset zone never shifts
an all-day event to the previous day.) All-day recurring series therefore stay
on the same calendar date across DST transitions in every timezone.
