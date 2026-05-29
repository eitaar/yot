// Minimal single-page client for manually exercising the REST API.
// Served at GET / (public). Same-origin, so fetch uses relative /api paths and
// the SSE feed uses ?key= for EventSource. Vanilla JS, no build step.
// Note: avoid backticks and ${ } in the embedded script so it stays a plain
// TypeScript template string.

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Calendar API — dev console</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 1rem;
         display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; max-width: 1100px; }
  header { grid-column: 1 / -1; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 1.1rem; margin: 0 1rem 0 0; }
  section { border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
            border-radius: 8px; padding: .75rem; }
  h2 { font-size: .95rem; margin: 0 0 .5rem; }
  input, button, select { font: inherit; padding: .35rem .5rem; border-radius: 6px;
            border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; }
  button { cursor: pointer; }
  form { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: .5rem; }
  ul { list-style: none; margin: .5rem 0 0; padding: 0; display: grid; gap: .3rem; }
  li { padding: .35rem .5rem; border-radius: 6px;
       background: color-mix(in srgb, currentColor 7%, transparent); display: flex; justify-content: space-between; gap: .5rem; }
  li button { padding: .1rem .4rem; font-size: .8rem; }
  pre { grid-column: 1 / -1; max-height: 220px; overflow: auto; padding: .5rem;
        border-radius: 8px; background: color-mix(in srgb, currentColor 7%, transparent); margin: 0; }
  .feed div { padding: .2rem .4rem; border-radius: 4px; font-family: ui-monospace, monospace; font-size: .8rem; }
  .ev { color: #2563eb; } .muted { opacity: .6; }
  .dot { width: .6rem; height: .6rem; border-radius: 50%; background: #888; display: inline-block; }
  .dot.on { background: #16a34a; } .dot.off { background: #dc2626; }
</style>
</head>
<body>
<header>
  <h1>Calendar API</h1>
  <input id="key" type="password" placeholder="API key (cal_...)" size="36" />
  <button id="save">Save key</button>
  <span><span id="sse" class="dot off"></span> SSE</span>
  <span id="status" class="muted"></span>
</header>

<section>
  <h2>Calendars</h2>
  <form id="calForm">
    <input name="name" placeholder="name" required />
    <input name="color" placeholder="#color" size="8" />
    <button>Add</button>
  </form>
  <ul id="cals"></ul>
</section>

<section>
  <h2>Events</h2>
  <form id="evForm">
    <select name="calendar_id" id="evCal" required></select>
    <input name="title" placeholder="title" required />
    <input name="start_at" type="datetime-local" required />
    <input name="end_at" type="datetime-local" required />
    <button>Add</button>
  </form>
  <ul id="events"></ul>
</section>

<section style="grid-column: 1 / -1">
  <h2>Realtime feed (SSE)</h2>
  <div id="feed" class="feed"></div>
</section>

<pre id="log"></pre>

<script>
var key = localStorage.getItem("yot_key") || "";
document.getElementById("key").value = key;

function log(label, data) {
  var pre = document.getElementById("log");
  pre.textContent = "[" + new Date().toLocaleTimeString() + "] " + label + "\\n" +
    (typeof data === "string" ? data : JSON.stringify(data, null, 2)) + "\\n\\n" + pre.textContent;
}
function setStatus(msg) { document.getElementById("status").textContent = msg; }

async function api(path, options) {
  options = options || {};
  options.headers = Object.assign({ "content-type": "application/json" },
    options.headers || {}, { "Authorization": "Bearer " + key });
  var res = await fetch("/api" + path, options);
  var text = await res.text();
  var body = text ? JSON.parse(text) : null;
  if (!res.ok) { log(options.method || "GET", path + " -> " + res.status + " " + (body && body.error ? body.error.message : text)); throw new Error(res.status); }
  log((options.method || "GET") + " " + path + " -> " + res.status, body);
  return body;
}

function isoFromLocal(v) { return v ? new Date(v).toISOString() : v; }

async function loadCalendars() {
  var cals = await api("/calendars");
  var ul = document.getElementById("cals"); ul.innerHTML = "";
  var sel = document.getElementById("evCal"); sel.innerHTML = "";
  cals.forEach(function (c) {
    var li = document.createElement("li");
    var label = document.createElement("span");
    label.textContent = (c.color ? c.color + " " : "") + c.name;
    var del = document.createElement("button"); del.textContent = "delete";
    del.onclick = function () { api("/calendars/" + c.id, { method: "DELETE" }).then(loadCalendars).then(loadEvents); };
    li.appendChild(label); li.appendChild(del); ul.appendChild(li);
    var opt = document.createElement("option"); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt);
  });
}

async function loadEvents() {
  var calId = document.getElementById("evCal").value;
  var events = await api("/events" + (calId ? "?calendarId=" + calId : ""));
  var ul = document.getElementById("events"); ul.innerHTML = "";
  events.forEach(function (e) {
    var li = document.createElement("li");
    var label = document.createElement("span");
    label.textContent = e.title + "  " + new Date(e.start_at).toLocaleString();
    var del = document.createElement("button"); del.textContent = "delete";
    del.onclick = function () { api("/events/" + e.id, { method: "DELETE" }).then(loadEvents); };
    li.appendChild(label); li.appendChild(del); ul.appendChild(li);
  });
}

document.getElementById("save").onclick = function () {
  key = document.getElementById("key").value.trim();
  localStorage.setItem("yot_key", key);
  setStatus("key saved"); connectSSE(); refresh();
};
document.getElementById("calForm").onsubmit = function (ev) {
  ev.preventDefault();
  var f = ev.target;
  var payload = { name: f.name.value };
  if (f.color.value) payload.color = f.color.value;
  api("/calendars", { method: "POST", body: JSON.stringify(payload) }).then(function () { f.reset(); loadCalendars(); });
};
document.getElementById("evForm").onsubmit = function (ev) {
  ev.preventDefault();
  var f = ev.target;
  var payload = { calendar_id: f.calendar_id.value, title: f.title.value,
    start_at: isoFromLocal(f.start_at.value), end_at: isoFromLocal(f.end_at.value) };
  api("/events", { method: "POST", body: JSON.stringify(payload) }).then(function () { f.reset(); loadEvents(); });
};
document.getElementById("evCal").onchange = loadEvents;

var es = null;
function connectSSE() {
  if (es) es.close();
  if (!key) return;
  es = new EventSource("/api/stream?key=" + encodeURIComponent(key));
  var dot = document.getElementById("sse");
  es.onopen = function () { dot.className = "dot on"; };
  es.onerror = function () { dot.className = "dot off"; };
  ["ready", "ping", "calendar.created", "calendar.updated", "calendar.deleted",
   "event.created", "event.updated", "event.deleted", "tag.created", "tag.deleted"].forEach(function (type) {
    es.addEventListener(type, function (m) {
      if (type !== "ping" && type !== "ready") { loadCalendars(); loadEvents(); }
      var feed = document.getElementById("feed");
      var div = document.createElement("div");
      div.innerHTML = "<span class=ev>" + type + "</span> <span class=muted>" + (m.data || "") + "</span>";
      feed.prepend(div);
      while (feed.childElementCount > 30) feed.removeChild(feed.lastChild);
    });
  });
}

function refresh() { loadCalendars().then(loadEvents).catch(function () {}); }
if (key) { connectSSE(); refresh(); } else { setStatus("enter an API key to begin"); }
</script>
</body>
</html>`;
