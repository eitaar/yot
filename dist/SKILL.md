---
name: yot
description: >
  Best practices for creating and managing calendar events with Yot. Use this skill
  whenever interacting with Yot calendar tools — creating events, updating events,
  importing ICS files, managing tags, setting reminders, or enriching events with
  context. Also trigger when the user asks to add something to their calendar, schedule
  something, set a reminder, or plan an itinerary that involves calendar entries.
  Even casual phrasing like "remind me about X", "put this on my calendar", or
  "schedule Y" should trigger this skill if Yot tools are available.
---

# yot — Tips for AI Agents

## Event anatomy: title / description / context

These three fields serve different audiences. Get them right and the calendar becomes useful for both the owner and any AI that reads it later.

**Don't duplicate across fields.** The event object already has `start_at`, `end_at`, `url`, and `location` — never repeat those in title, description, or context. Each field should only contain information that isn't already stored elsewhere in the event.

**title** — What shows up on the calendar grid. Keep it scannable: 2–5 words, no dates or times (the calendar already shows those). Good: `Dental checkup`. Bad: `Dentist appointment on July 20th at 3pm at Dr. Smith's`.

**description** — What the owner reads when they tap an event. Actionable info they need on the day: confirmation numbers, what to bring, who to contact. Write it like a sticky note — not a paragraph.

**context** — What an AI reads when it needs to reason about the event. This is the most valuable field — pack it generously. Include everything useful for decision-making that would clutter the description: address, phone, access directions, parking, transit options, cost breakdowns, reviews/ratings, hours of operation, dietary restrictions, booking policies, cancellation terms, relevant history, related events, and anything else a well-prepared assistant would look up in advance. **Always write context in English**, regardless of the user's language — it's for AI consumption, and English maximizes compatibility across models. Not displayed in the UI, so length is not a concern — err on the side of too much rather than too little.

### Example: a dentist visit

```
title: Dental checkup

description: |
  Dr. Smith's Dental, Appt #A-1234
  Bring: referral letter, toothbrush

context: |
  Clinic: 123 Main St Suite 200, (555) 123-4567
  Access: 5 min walk from Central Station south exit
  Parking: 3 dedicated spots; overflow at CityPark garage 2 min walk, $4/hr
  Hours: Mon-Fri 9am-6pm, Sat 9am-1pm, closed Sun
  Cost: $150-300 (insurance copay ~$30)
  Reviews: Google 4.2/5 (120 reviews), short wait times
  Last visit: 2025-12-15 cleaning, next in 6 months recommended
```

### Example: a flight

```
title: HND→FUK ANA243

description: |
  ANA243, Haneda 10:15→Fukuoka 12:20
  Seat 12A, conf# XXXXXX

context: |
  Terminal 2, security closes 15 min before departure
  Check-in done, QR in ANA app
  Carry-on only (roller + backpack)
  ANA LOUNGE 3F (card required)
  Airport→city: subway to Hakata 5 min ¥260
  Weather (Fukuoka, fetched 7/19): cloudy 22°C
  Return: 7/22 ANA256 FUK 18:00
```

### Example: team lunch

```
title: Team lunch

description: |
  Trattoria Roma, 12:00
  Reserved for 4 under "Tanaka"

context: |
  456 Oak Ave 2F, (555) 987-6543
  Lunch set $18/person, drinks separate
  Sato — shellfish allergy
  8 min walk from Shibuya west exit
  Fridays are busy, arrive 5 min early
```

## Writing good context

Context is the event's knowledge base. The goal is to make the calendar self-sufficient — when the owner or a future AI revisits the event, they should never need to re-search for basic logistics.

- **Default to thorough.** If you have access to web search, use it. Look up the venue's address, phone, hours, transit access, parking, cost, reviews, and anything else a personal assistant would brief you on. Five useful lines are better than one vague one.
- **Cover the obvious questions.** "How do I get there?" "How much will it cost?" "What should I watch out for?" "What's nearby?" "What happened last time?" If context answers these without a web search, it's doing its job.
- **Include related logistics.** For a flight, add terminal info, lounge access, ground transport at destination. For a restaurant, add the menu price range, reservation policy, and allergy notes for attendees. For a deadline, add submission portal URL and format requirements.
- **Link to the past and future.** If there's a previous related event ("Last dental cleaning: 2025-12-15"), note it. If there's a follow-up ("Return flight: 7/22 ANA256"), include it.
- **Don't repeat other fields.** Context complements title, description, url, location, and start/end times — it doesn't echo them. Description likewise shouldn't parrot start_at or url.
- **Label uncertainty.** Facts are facts. Estimates, reviews, and forecasts should say so.
- **Note freshness for perishable info.** Weather, prices, availability — add when you looked it up.
- **No template.** A dentist needs parking info; a dinner needs allergy notes; a deadline needs nothing. Write what's useful — but when in doubt, include it.

## Using tags effectively

Tags work best as a small, stable vocabulary — not one-off labels. A few well-chosen tags let the owner filter their calendar views.

Good tag sets: `work`, `personal`, `travel`, `health`, `social`.
Avoid: creating a new tag per event, or tags that overlap (`meeting` + `work-meeting`).

Check `list_tags` before creating a new one — reuse existing tags when they fit.

## Reminders

`minutes_before` is relative to `start_at`. Common values:

| Lead time | minutes_before |
|---|---|
| At start | 0 |
| 15 min | 15 |
| 1 hour | 60 |
| 1 day | 1440 |
| 1 week | 10080 |

Don't over-remind. One well-timed reminder beats three that get ignored. For most events, 15–60 minutes is enough. Flights and all-day events may warrant a day-before reminder.

## Images

Use `upload_image_from_url` to give events a cover image — the calendar grid shows them as visual cards. Good candidates: restaurant photos, venue shots, event posters, destination landmarks. Skip generic stock photos; they add noise, not information.

## ICS import

When importing .ics files, know the limitations:
- Recurring events (RRULE) are skipped — only one-off events come through.
- Duplicate UIDs in the same calendar are skipped.
- Imported events have no `context` — consider enriching important ones after import.

## General habits

- **Always list calendars first** if you don't know the `calendar_id`. Events require one.
- **Use `from`/`to` filters** when listing events. Fetching the entire history wastes tokens.
- **Prefer update over delete+recreate.** Update preserves the event ID, tags, and reminders.
- **`q` searches title and description only**, not context. If you need to find something you put in context, filter by date range or tag instead.
- **Nullable field semantics on update:** value → set, `null` → clear, omit → keep. This matters — sending `null` for description deletes it, omitting it leaves it alone.
