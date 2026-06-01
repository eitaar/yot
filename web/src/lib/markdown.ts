import MarkdownIt from "markdown-it";

// html:false escapes raw HTML; markdown-it's validateLink() blocks javascript:/data:
// in links and images, so only http(s) URLs pass. Markdown image syntax still renders
// real <img> tags from https sources (a privacy note, not an XSS risk). Safe for v-html.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Open links in a new tab.
const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx].attrSet("target", "_blank");
	tokens[idx].attrSet("rel", "noopener noreferrer");
	return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Render markdown to safe HTML. Imported descriptions sometimes carry literal
 * backslash-n; normalize those to real newlines first. */
export function renderMarkdown(src: string | null | undefined): string {
	return md.render((src ?? "").replace(/\\n/g, "\n"));
}
