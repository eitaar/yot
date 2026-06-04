import type MarkdownIt from "markdown-it";

// markdown-it is ~130KB. It's only needed when an event description is rendered
// (the event modal), so load it lazily on first use and let Vite split it into
// its own async chunk instead of bundling it into every view.
let mdPromise: Promise<MarkdownIt> | null = null;

function loadMd(): Promise<MarkdownIt> {
	if (!mdPromise) {
		mdPromise = import("markdown-it").then(({ default: MarkdownIt }) => {
			// html:false escapes raw HTML; markdown-it's validateLink() blocks javascript:/data:
			// in links and images, so only http(s) URLs pass. Markdown image syntax still renders
			// real <img> tags from https sources (a privacy note, not an XSS risk). Safe for v-html.
			const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

			// Open links in a new tab.
			const defaultLinkOpen =
				md.renderer.rules.link_open ??
				((tokens, idx, options, _env, self) =>
					self.renderToken(tokens, idx, options));
			md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
				tokens[idx].attrSet("target", "_blank");
				tokens[idx].attrSet("rel", "noopener noreferrer");
				return defaultLinkOpen(tokens, idx, options, env, self);
			};
			return md;
		});
	}
	return mdPromise;
}

/** Render markdown to safe HTML. Imported descriptions sometimes carry literal
 * backslash-n; normalize those to real newlines first. Async because the
 * markdown-it engine is code-split and loaded on demand. */
export async function renderMarkdown(
	src: string | null | undefined,
): Promise<string> {
	const md = await loadMd();
	return md.render((src ?? "").replace(/\\n/g, "\n"));
}
