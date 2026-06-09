<script lang="ts">
	import Tabs from '$components/ui/Tabs.svelte';
	import CopyButton from '$components/ui/CopyButton.svelte';
	import type { TokenPermissions } from '$api/crud';

	let {
		token = null,
		permissions,
	}: {
		/** The real secret, embedded into snippets only at creation/rotation time. */
		token?: string | null;
		permissions: TokenPermissions;
	} = $props();

	const LANGS = ['curl', 'Python', 'R'];
	let lang = $state(0);

	const apiBase = typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';
	const tokenValue = $derived(token ?? 'YOUR_API_TOKEN');
	const usingPlaceholder = $derived(!token);

	type Example = {
		id: string;
		label: string;
		requires: keyof TokenPermissions;
		method: 'GET' | 'POST';
		path: string;
		body?: unknown;
	};

	const RANGE = 'start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z';
	const ALL: Example[] = [
		{ id: 'list-sites', label: 'List sites', requires: 'read_metadata', method: 'GET', path: '/sites' },
		{ id: 'readings', label: 'Get readings from a site', requires: 'read_data', method: 'GET', path: `/sites/<site-id>/readings?${RANGE}` },
		{ id: 'aggregates', label: 'Get daily aggregates', requires: 'read_data', method: 'GET', path: `/sites/<site-id>/aggregates/daily?${RANGE}` },
		{ id: 'alarms', label: 'Get site alarms', requires: 'read_data', method: 'GET', path: `/sites/<site-id>/alarms?${RANGE}` },
		{
			id: 'ingest',
			label: 'Push a reading',
			requires: 'write_data',
			method: 'POST',
			path: '/readings/batch',
			body: { readings: [{ site_id: '<site-id>', parameter_id: '<parameter-id>', time: '2025-01-01T00:00:00Z', raw_value: 12.3 }] },
		},
	];

	const examples = $derived(ALL.filter((e) => permissions[e.requires]));
	let exampleId = $state('list-sites');
	$effect(() => {
		if (examples.length && !examples.some((e) => e.id === exampleId)) exampleId = examples[0].id;
	});
	const ex = $derived(examples.find((e) => e.id === exampleId) ?? examples[0]);

	function curl(e: Example, url: string, tok: string): string {
		if (e.method === 'GET') return `curl -H "Authorization: Bearer ${tok}" \\\n  "${url}"`;
		return (
			`curl -X POST \\\n` +
			`  -H "Authorization: Bearer ${tok}" \\\n` +
			`  -H "Content-Type: application/json" \\\n` +
			`  -d '${JSON.stringify(e.body)}' \\\n  "${url}"`
		);
	}

	function python(e: Example, url: string, tok: string): string {
		const head = `import requests\n\nTOKEN = "${tok}"`;
		if (e.method === 'GET')
			return `${head}\n\nr = requests.get(\n    "${url}",\n    headers={"Authorization": f"Bearer {TOKEN}"},\n)\nr.raise_for_status()\nprint(r.json())`;
		return `${head}\n\npayload = ${JSON.stringify(e.body, null, 4)}\n\nr = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},\n    json=payload,\n)\nr.raise_for_status()\nprint(r.json())`;
	}

	function rlang(e: Example, url: string, tok: string): string {
		const head = `library(httr)\n\ntoken <- "${tok}"`;
		if (e.method === 'GET')
			return `${head}\n\nr <- GET(\n  "${url}",\n  add_headers(Authorization = paste("Bearer", token))\n)\ncontent(r)`;
		return `${head}\n\nbody <- '${JSON.stringify(e.body)}'\n\nr <- POST(\n  "${url}",\n  add_headers(Authorization = paste("Bearer", token), \`Content-Type\` = "application/json"),\n  body = body\n)\ncontent(r)`;
	}

	const code = $derived.by(() => {
		if (!ex) return '';
		const url = `${apiBase}${ex.path}`;
		if (lang === 0) return curl(ex, url, tokenValue);
		if (lang === 1) return python(ex, url, tokenValue);
		return rlang(ex, url, tokenValue);
	});
</script>

<div class="space-y-3">
	{#if examples.length === 0}
		<p class="text-sm text-brand-muted">This key has no read or write capabilities, so there's nothing to call yet.</p>
	{:else}
		<!-- Example picker -->
		<div class="flex flex-wrap gap-1.5">
			{#each examples as e}
				<button
					type="button"
					onclick={() => (exampleId = e.id)}
					class="text-xs px-2.5 py-1 rounded-full border cursor-pointer {exampleId === e.id
						? 'border-brand-primary bg-brand-primary text-white'
						: 'border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg'}"
				>
					{e.label}
				</button>
			{/each}
		</div>

		<!-- Language tabs -->
		<Tabs tabs={LANGS} bind:active={lang} />

		<!-- Snippet -->
		<div class="relative">
			<pre class="bg-brand-bg border border-brand-divider rounded-md p-3 pr-20 text-xs font-mono overflow-x-auto whitespace-pre">{code}</pre>
			<div class="absolute top-2 right-2"><CopyButton text={code} small /></div>
		</div>

		{#if usingPlaceholder}
			<p class="text-xs text-brand-muted">
				Replace <code class="bg-brand-bg px-1 rounded">YOUR_API_TOKEN</code> with your key, and
				<code class="bg-brand-bg px-1 rounded">&lt;site-id&gt;</code> /
				<code class="bg-brand-bg px-1 rounded">&lt;parameter-id&gt;</code> with ids from the list-sites response.
			</p>
		{:else}
			<p class="text-xs text-brand-muted">
				Your key is embedded above for copy-paste. Replace
				<code class="bg-brand-bg px-1 rounded">&lt;site-id&gt;</code> /
				<code class="bg-brand-bg px-1 rounded">&lt;parameter-id&gt;</code> with real ids. This is the only
				time the key is shown.
			</p>
		{/if}
	{/if}
</div>
