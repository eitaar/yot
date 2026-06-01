import { ApiKeyService } from "../auth/apikey.js";
import { PairingService } from "../auth/pairing.js";
import type { EventBus } from "../core/event-bus.js";
import type { DB } from "../db/connection.js";
import { CalendarService } from "./calendar.service.js";
import { EventService } from "./event.service.js";
import { ImageService } from "./image.service.js";
import { TagService } from "./tag.service.js";

/** The shared set of services consumed by REST, MCP, and SSE. */
export type Services = {
	calendars: CalendarService;
	events: EventService;
	tags: TagService;
	apiKeys: ApiKeyService;
	pairing: PairingService;
	images: ImageService;
};

/** Construct every service against one db connection and event bus. */
export function createServices(db: DB, bus: EventBus): Services {
	// Read at call time (not module load) so tests can set IMG_DIR per run.
	const images = new ImageService(process.env.IMG_DIR ?? "data/img");
	const pairing = new PairingService();
	return {
		calendars: new CalendarService(db, bus),
		events: new EventService(db, bus, images),
		tags: new TagService(db, bus),
		apiKeys: new ApiKeyService(db),
		pairing,
		images,
	};
}
