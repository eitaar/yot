// Shared types + formatting for the custom Schedule-X event components.
// The object Schedule-X hands these components is exactly what we put into
// `eventsService.set()` (see CalendarView.syncEvents), including our custom
// underscore-prefixed props, which Schedule-X preserves verbatim.

export type SxTag = { name: string; color: string };

export type SxEvent = {
	id: string;
	title?: string;
	/** "YYYY-MM-DD" (all day) or "YYYY-MM-DD HH:mm" (timed). */
	start: string;
	end: string;
	calendarId?: string;
	description?: string;
	location?: string;
	people?: string[];
	/** Calendar color, used for the chip accent. */
	_calColor?: string;
	_tags?: SxTag[];
	_allDay?: boolean;
};

const TIME_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/** Localized "HH:mm" from a Schedule-X date string, or "" for date-only. */
export function formatTime(value: string): string {
	if (!TIME_RE.test(value)) return "";
	const d = new Date(value.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return value.slice(11, 16);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "All day", "09:00", or "09:00 – 10:30" depending on the event. */
export function timeRange(ev: SxEvent): string {
	if (ev._allDay) return "All day";
	const s = formatTime(ev.start);
	const e = formatTime(ev.end);
	if (!s) return "";
	return e && e !== s ? `${s} – ${e}` : s;
}

/** Accent color for an event, falling back to the theme primary. */
export function eventColor(ev: SxEvent): string {
	return ev._calColor || "var(--color-primary)";
}
