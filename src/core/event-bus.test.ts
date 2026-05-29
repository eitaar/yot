import assert from "node:assert/strict";
import { test } from "node:test";
import { type ChangeEvent, EventBus } from "./event-bus.js";

test("emit delivers the event to a subscribed listener", () => {
	const bus = new EventBus();
	const received: ChangeEvent[] = [];
	bus.subscribe((ev) => received.push(ev));

	bus.emit({ type: "event.created", data: { id: "e1" } });

	assert.deepEqual(received, [{ type: "event.created", data: { id: "e1" } }]);
});

test("emit delivers to every subscribed listener", () => {
	const bus = new EventBus();
	let a = 0;
	let b = 0;
	bus.subscribe(() => a++);
	bus.subscribe(() => b++);

	bus.emit({ type: "calendar.deleted", data: { id: "c1" } });

	assert.equal(a, 1);
	assert.equal(b, 1);
});

test("unsubscribe stops further delivery", () => {
	const bus = new EventBus();
	let count = 0;
	const unsubscribe = bus.subscribe(() => count++);

	bus.emit({ type: "tag.created", data: {} });
	unsubscribe();
	bus.emit({ type: "tag.created", data: {} });

	assert.equal(count, 1);
});

test("emit with no listeners does not throw", () => {
	const bus = new EventBus();
	assert.doesNotThrow(() => bus.emit({ type: "event.updated", data: {} }));
});
