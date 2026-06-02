<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	let { source, class: className = '' }: { source: string | null | undefined; class?: string } =
		$props();

	const html = $derived(
		source ? DOMPurify.sanitize(marked.parse(source, { async: false }) as string) : ''
	);
</script>

{#if html}
	<div class="markdown {className}">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html html}
	</div>
{:else}
	<p class="text-sm text-brand-muted">---</p>
{/if}

<style>
	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4) {
		font-weight: 600;
		line-height: 1.3;
		margin: 1em 0 0.4em;
	}
	.markdown :global(h1) {
		font-size: 1.25rem;
	}
	.markdown :global(h2) {
		font-size: 1.1rem;
	}
	.markdown :global(h3) {
		font-size: 1rem;
	}
	.markdown :global(p) {
		margin: 0.5em 0;
		font-size: 0.875rem;
		line-height: 1.5;
	}
	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0.5em 0;
		padding-left: 1.4em;
		font-size: 0.875rem;
		line-height: 1.5;
	}
	.markdown :global(ul) {
		list-style: disc;
	}
	.markdown :global(ol) {
		list-style: decimal;
	}
	.markdown :global(li) {
		margin: 0.15em 0;
	}
	.markdown :global(a) {
		color: var(--color-brand-primary, #1f4e79);
		text-decoration: underline;
	}
	.markdown :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.8em;
		background: var(--color-brand-bg, #f3f4f6);
		padding: 0.1em 0.3em;
		border-radius: 0.25rem;
	}
	.markdown :global(pre) {
		background: var(--color-brand-bg, #f3f4f6);
		padding: 0.75em 1em;
		border-radius: 0.375rem;
		overflow-x: auto;
		margin: 0.6em 0;
	}
	.markdown :global(pre code) {
		background: none;
		padding: 0;
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.markdown :global(blockquote) {
		border-left: 3px solid var(--color-brand-divider, #d1d5db);
		padding-left: 0.8em;
		margin: 0.6em 0;
		color: var(--color-brand-muted, #6b7280);
	}
	.markdown :global(hr) {
		border: none;
		border-top: 1px solid var(--color-brand-divider, #d1d5db);
		margin: 1em 0;
	}
	.markdown :global(table) {
		border-collapse: collapse;
		margin: 0.6em 0;
		font-size: 0.8125rem;
	}
	.markdown :global(th),
	.markdown :global(td) {
		border: 1px solid var(--color-brand-divider, #d1d5db);
		padding: 0.3em 0.6em;
		text-align: left;
	}
	.markdown :global(strong) {
		font-weight: 600;
	}
</style>
