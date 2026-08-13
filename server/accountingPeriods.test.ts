import assert from "node:assert/strict";
import { accountingPeriod, adjacentAccountingPeriods } from "./accountingPeriods";
import { compareInstantToUtcRange, formatPresentation, presentationTimezone } from "./timeService";

function period(type: "daily" | "weekly" | "monthly" | "yearly", iso: string, timezone = "America/New_York") {
  return accountingPeriod(type, new Date(iso), timezone);
}

{
  const before = period("daily", "2026-01-15T21:59:59.000Z");
  const exact = period("daily", "2026-01-15T22:00:00.000Z");
  assert.equal(before.startUtc, "2026-01-14T22:00:00.000Z");
  assert.equal(before.endUtc, "2026-01-15T22:00:00.000Z");
  assert.equal(exact.startUtc, "2026-01-15T22:00:00.000Z");
  assert.equal(formatPresentation(exact.startUtc, "America/New_York"), "Jan 15, 5:00 PM EST");
}

{
  const before = period("daily", "2026-08-12T20:59:59.000Z");
  const exact = period("daily", "2026-08-12T21:00:00.000Z");
  assert.equal(before.startUtc, "2026-08-11T21:00:00.000Z");
  assert.equal(before.endUtc, "2026-08-12T21:00:00.000Z");
  assert.equal(exact.startUtc, "2026-08-12T21:00:00.000Z");
  assert.equal(formatPresentation(exact.startUtc, "America/New_York"), "Aug 12, 5:00 PM EDT");
}

{
  const spring = period("daily", "2026-03-08T21:00:00.000Z");
  const fall = period("daily", "2026-11-01T22:00:00.000Z");
  assert.equal(spring.startUtc, "2026-03-08T21:00:00.000Z");
  assert.equal(fall.startUtc, "2026-11-01T22:00:00.000Z");
  assert.equal(formatPresentation(spring.startUtc, "America/New_York"), "Mar 08, 5:00 PM EDT");
  assert.equal(formatPresentation(fall.startUtc, "America/New_York"), "Nov 01, 5:00 PM EST");
}

{
  const ny = period("daily", "2026-08-13T13:00:00.000Z", "America/New_York");
  const london = period("daily", "2026-08-13T13:00:00.000Z", "Europe/London");
  assert.equal(ny.startUtc, london.startUtc);
  assert.equal(ny.endUtc, london.endUtc);
  assert.notEqual(ny.presentationStart, london.presentationStart);
  assert.equal(presentationTimezone({ FINCOACH_PRESENTATION_TIMEZONE: "Europe/London" } as NodeJS.ProcessEnv), "Europe/London");
}

{
  const sundayBefore = period("weekly", "2026-08-09T20:59:59.000Z");
  const sundayExact = period("weekly", "2026-08-09T21:00:00.000Z");
  const fridayBefore = period("weekly", "2026-08-14T20:59:59.000Z");
  const fridayExact = period("weekly", "2026-08-14T21:00:00.000Z");
  assert.equal(sundayBefore.startUtc, "2026-08-02T21:00:00.000Z");
  assert.equal(sundayBefore.endUtc, "2026-08-07T21:00:00.000Z");
  assert.equal(sundayExact.startUtc, "2026-08-09T21:00:00.000Z");
  assert.equal(fridayBefore.startUtc, "2026-08-09T21:00:00.000Z");
  assert.equal(fridayBefore.endUtc, "2026-08-14T21:00:00.000Z");
  assert.equal(fridayExact.endUtc, "2026-08-14T21:00:00.000Z");
}

{
  const monthBefore = period("monthly", "2026-09-01T20:59:59.000Z");
  const monthExact = period("monthly", "2026-09-01T21:00:00.000Z");
  assert.equal(monthBefore.startUtc, "2026-08-01T21:00:00.000Z");
  assert.equal(monthBefore.endUtc, "2026-09-01T21:00:00.000Z");
  assert.equal(monthExact.startUtc, "2026-09-01T21:00:00.000Z");
}

{
  const yearBefore = period("yearly", "2027-01-01T21:59:59.000Z");
  const yearExact = period("yearly", "2027-01-01T22:00:00.000Z");
  assert.equal(yearBefore.startUtc, "2026-01-01T22:00:00.000Z");
  assert.equal(yearBefore.endUtc, "2027-01-01T22:00:00.000Z");
  assert.equal(yearExact.startUtc, "2027-01-01T22:00:00.000Z");
}

{
  const adjacent = adjacentAccountingPeriods("daily", new Date("2026-08-13T13:00:00.000Z"));
  assert.equal(adjacent.previous.endUtc, adjacent.current.startUtc);
  assert.equal(adjacent.current.endUtc, adjacent.next.startUtc);
  const boundary = adjacent.current.endUtc;
  assert.equal(compareInstantToUtcRange(new Date(Date.parse(boundary) - 1), adjacent.current.startUtc, adjacent.current.endUtc), true);
  assert.equal(compareInstantToUtcRange(boundary, adjacent.current.startUtc, adjacent.current.endUtc), false);
  assert.equal(compareInstantToUtcRange(boundary, adjacent.next.startUtc, adjacent.next.endUtc), true);
}

{
  for (const type of ["daily", "monthly", "yearly"] as const) {
    const adjacent = adjacentAccountingPeriods(type, new Date("2026-08-13T13:00:00.000Z"));
    assert.equal(adjacent.previous.endUtc, adjacent.current.startUtc);
    assert.equal(adjacent.current.endUtc, adjacent.next.startUtc);
    const instants = [
      new Date(Date.parse(adjacent.previous.endUtc) - 1),
      adjacent.current.startUtc,
      new Date(Date.parse(adjacent.current.endUtc) - 1),
      adjacent.current.endUtc,
    ];
    for (const instant of instants) {
      const membership = [adjacent.previous, adjacent.current, adjacent.next]
        .filter(candidate => compareInstantToUtcRange(instant, candidate.startUtc, candidate.endUtc));
      assert.equal(membership.length, 1, `${type} membership should be exactly one period for ${instant}`);
    }
  }
  const weekly = adjacentAccountingPeriods("weekly", new Date("2026-08-13T13:00:00.000Z"));
  assert.equal(weekly.previous.endUtc, "2026-08-07T21:00:00.000Z");
  assert.equal(weekly.current.startUtc, "2026-08-09T21:00:00.000Z");
  assert.equal(compareInstantToUtcRange("2026-08-08T12:00:00.000Z", weekly.previous.startUtc, weekly.previous.endUtc), false);
  assert.equal(compareInstantToUtcRange("2026-08-08T12:00:00.000Z", weekly.current.startUtc, weekly.current.endUtc), false);
}

console.log("accounting period boundary tests passed");
