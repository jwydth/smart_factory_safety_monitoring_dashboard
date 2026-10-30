# User guide

For HSE staff using the dashboard. No technical knowledge assumed. If you need to
install or restart the system, that is [OPERATIONS.md](./OPERATIONS.md).

Open the dashboard at **http://localhost:3000** (or the address your IT team gives
you).

## Read this first: what the system is and is not

It is an **assistant, not a referee.** It watches camera feeds and flags things worth
a human look. It does not decide anything, and it is not a record of fact.

**Every model was trained on computer-generated video, not on footage from a De Heus
site.** Nobody has measured how accurately it performs on your real cameras. Expect
both misses and false alarms, and treat every incident as a prompt to check rather
than as proof. The badge in the corner of each camera tile saying the footage is
AI-generated demo content is there for the same reason.

---

## The three tabs

| Tab | What it is for |
| --- | --- |
| **Camera Feeds** | Watch live cameras, set up zones, respond to sign suggestions |
| **Live Incident Panel** | The incident log, with filters |
| **Analytics** | Trends, comparisons, and report generation |

There is also a **3D Map** view which is **not shown in the navigation**. It still
works if you open the dashboard with `?view=factory3d` on the end of the address, but
it is unfinished — only one of its three areas is wired to a real camera — so treat
it as a preview rather than a tool.

---

## Camera Feeds

### Watching cameras

Select cameras to view them. Several can be shown at once in a grid.

The video you see is **delayed by about three seconds**. This is deliberate: the
system holds each frame back just long enough to draw the boxes and labels onto the
same picture they belong to, so what you see is always internally consistent. It is
not a performance problem.

A few seconds of black video right after you load or reload the page is normal while
the player starts. If it stays black, tell whoever operates the system — there is a
checklist for it in [OPERATIONS.md](./OPERATIONS.md).

### Turning checks on and off per camera

Each camera has its own switches, found under **Configure cameras**:

- **PPE** — flags people missing a helmet, vest or cleaning coverall
- **Zone Monitoring** — flags people entering zones you have drawn
- **Behavior Detection** — flags running and falling

Turn off what a camera cannot usefully see. A camera pointed at a corridor does not
need slippery-floor monitoring.

**If Behavior Detection shows "unavailable"**, that camera's video is arriving too
slowly for it to work. It needs 24 frames per second and cannot work with less. This
is not something you can fix from the dashboard — pass it on.

### Drawing zones

Draw a shape on a camera's view and choose what kind of zone it is:

| Zone type | What it does | Default delay before flagging |
| --- | --- | --- |
| **Restricted** | Nobody should be here. Entry is flagged. | 1.5 seconds |
| **Walkway** | People should stay *inside* this. Being outside it is flagged. | 3 seconds |
| **Slippery** | Flags people in a wet or hazardous area. | 1.5 seconds |
| **Exclusion** | **The opposite of the others.** Anything here is ignored entirely. | immediate |

The delay exists so somebody briefly clipping the edge of a zone does not generate an
incident. Someone has to actually be there.

**Exclusion zones are the most useful one to understand.** Use one wherever the camera
sees something it should not police:

- a doorway onto a public walkway
- a monitor or poster showing pictures of people
- a reflective surface that creates phantom detections

Anything inside an exclusion zone is dropped before it is recorded. Exclusion zones
are the only type allowed to overlap other zones — that is the point, since you are
masking part of an area you still want monitored.

Zones belong to the camera you drew them on, and they are judged on **where a person's
feet are**, not their head or body centre. Someone leaning over a restricted area
while standing outside it is not flagged.

### Janitors are treated differently

A person detected in a **cleaning coverall** is treated as a janitor, and janitors are
**not** flagged in slippery zones — mopping a wet floor is the job, not a violation.

Janitors are still flagged in restricted zones, and still flagged if they are missing
PPE they should be wearing.

### Sign suggestions

When a camera sees a safety sign, the system offers to create the matching zone for
you:

- **No Thoroughfare** sign → suggests a Restricted zone
- **Slippery** sign → suggests a Slippery zone
- **Helmet** or **Vest** sign → switches on PPE checking for that camera

You **accept** or **dismiss** each suggestion. Nothing is created without you.

A sign must sit still for about **three seconds** before anything is suggested, so
carrying a sign across the floor does not leave a trail of zones behind you.

Once you accept a suggestion, it will not be offered again while a zone of that type
covers the area. If you dismiss one, it stays dismissed.

---

## Live Incident Panel

The log of everything recorded. Each entry shows the camera name, what happened, when,
and a severity badge.

### Filtering

Open the filter bar to narrow the list by:

- **Type** — PPE, Zone, Behavior (choose any combination)
- **Severity** — Critical, High, Medium, Low (any combination)
- **Time** — last 24 hours, 7 days, 30 days, or a custom range

Filtering searches the **whole** log, not just what is currently on screen, so a
filter will find old incidents. The panel remembers whether you left the filter bar
open.

### What the severity levels mean

| Severity | When it is used |
| --- | --- |
| **Critical** | Reserved. Nothing currently produces it. |
| **High** | Entering a restricted zone; a fall; missing several PPE items at once |
| **Medium** | Missing one PPE item; a walkway or slippery incursion; running |
| **Low** | Historical proximity warnings only |

**Missing PPE is never Critical.** Severity reflects how many rules are being broken
at once, not how dangerous the situation is. A single missing helmet is Medium. Use
your own judgement about urgency — the badge is a sorting aid, not a risk assessment.

### Deleting incidents

**Deleting is permanent and there is no undo.**

Deleting everything requires typing `DELETE` to confirm, and tells you how many
records you are about to destroy. Read that number before confirming.

Note that deleting an incident does **not** reliably delete its saved photo from
storage. If you need something genuinely gone, ask whoever operates the system.

---

## Analytics

### The numbers at the top

**Open Incidents** counts **Critical and High severity only**, within the range you
have selected. Medium and Low incidents are real and are in the log; they are simply
not in this number. A quiet "Open Incidents" figure does not mean a quiet day.

**Live / Total Cameras** shows how many cameras are streaming right now against how
many are registered. These are different things: a camera can be registered and not
streaming.

If a number shows a placeholder instead of a figure, the system is still loading. It
deliberately shows nothing rather than guessing — a wrong number on a safety readout
is worse than no number.

You may notice there are only two figures. Two others (PPE Compliance, People On
Shift) were removed because there was no reliable data behind them.

### Charts

Trends over time, breakdowns by zone and by type, and comparisons between periods.
Selecting a zone filters the whole view to that zone.

**One caveat worth knowing:** over a very long date range with a very large number of
incidents, the charts can quietly omit the oldest records. If a long-range total looks
lower than you expect, ask whoever operates the system to check the logs for a
truncation warning.

---

## Reports

### Download a PDF

Generates a report for the period you choose, including summary figures, a table of
incidents and photographic evidence thumbnails.

Reports can be generated in **English or Vietnamese**. The incident types, zone names
and camera names stay as they were entered; the report's own headings, labels and
written summary are translated.

Report timestamps are shown in Vietnam time (Asia/Ho_Chi_Minh) by default.

### Email a report

Sends the same report by email. Schedule recurring reports from the same area.

Two things to know:

- **Scheduled reports only arrive while the system is running.** If it is switched off
  when a report is due, that report is not sent and is not caught up later.
- Recipients may be restricted to approved addresses. If an address is refused, that is
  the restriction working.

---

## When something looks wrong

| What you see | What it usually means |
| --- | --- |
| Black video, more than a few seconds | Stream problem — report it |
| "Behavior detection unavailable" | That camera's video is too slow for behavior detection |
| A person flagged who was doing nothing wrong | A false positive. Consider an exclusion zone if it repeats in the same spot. |
| The same phantom detection in one place | Draw an **Exclusion** zone over it |
| An incident with no photo | The snapshot failed to save; the incident itself is still real |
| Numbers that disagree between tabs | Check the date range and zone filter are the same on both |

Nothing in the dashboard requires a password. Anyone who can open the page can change
zones and delete incidents, so treat access to it as access to the records.
