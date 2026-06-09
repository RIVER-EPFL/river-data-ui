<script lang="ts">
	import { onMount } from 'svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import CopyButton from '$components/ui/CopyButton.svelte';
	import { GET } from '$api/client';
	import { api, type TokenPermissions, type Site, type SiteParameter } from '$api/crud';

	let {
		token = null,
		permissions,
		projectScope = null,
	}: {
		/** The real secret, embedded into snippets only at creation/rotation time. */
		token?: string | null;
		permissions: TokenPermissions;
		/** When the key is project-scoped, only that project's sites are offered. */
		projectScope?: string | null;
	} = $props();

	const LANGS = ['curl', 'Python', 'R'];
	let lang = $state(0);

	const apiBase = typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

	// At creation the real secret is passed in and embedded. Elsewhere (the list "Usage" dialog)
	// the secret isn't stored, so let the holder paste it in to embed it into the snippets - it
	// only ever lives in this browser tab.
	let pastedToken = $state('');
	const allowPaste = $derived(!token);
	const effectiveToken = $derived(token ?? (pastedToken.trim() || null));
	const tokenValue = $derived(effectiveToken ?? 'YOUR_API_TOKEN');
	const usingPlaceholder = $derived(!effectiveToken);
	const pasteLooksValid = $derived(/^rvd_[0-9a-f]{16}_[0-9a-f]{64}$/.test(pastedToken.trim()));

	/** ISO 8601 in UTC with second precision (drops the milliseconds chrono doesn't need). */
	function isoZ(d: Date): string {
		return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	// Real ids to drop into the examples, fetched live and confined to the key's project.
	let sites = $state<Site[]>([]);
	let allSiteParams = $state<SiteParameter[]>([]);
	let paramNames = $state<Record<string, string>>({});
	let siteId = $state('');
	let paramId = $state('');
	let nowIso = $state('2025-01-01T00:00:00Z');

	// The selected site's actual data extent (from /sites/{id}/detail - cheap, no bulk download).
	let dataStart = $state<string | null>(null);
	let dataEnd = $state<string | null>(null);

	onMount(async () => {
		nowIso = isoZ(new Date());
		try {
			const [siteResult, spResult, paramResult] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.siteParameters.list({ perPage: 1000 }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = projectScope
				? siteResult.data.filter((s) => s.project_id === projectScope)
				: siteResult.data;
			allSiteParams = spResult.data;
			paramNames = Object.fromEntries(paramResult.data.map((p) => [p.id, p.name]));
			if (sites.length) siteId = sites[0].id;
		} catch {
			// Fall back to <site-id> / <parameter-id> placeholders if discovery fails.
		}
	});

	const siteParams = $derived(allSiteParams.filter((sp) => sp.site_id === siteId));
	$effect(() => {
		if (siteParams.length && !siteParams.some((sp) => sp.parameter_id === paramId)) {
			paramId = siteParams[0].parameter_id;
		}
	});

	// Load the data extent whenever the selected site changes (guarded against stale responses).
	let detailReq = 0;
	$effect(() => {
		const id = siteId;
		if (!id) {
			dataStart = null;
			dataEnd = null;
			return;
		}
		const req = ++detailReq;
		GET<{ data_start: string | null; data_end: string | null }>(`/api/sites/${id}/detail`)
			.then((d) => {
				if (req === detailReq) {
					dataStart = d.data_start;
					dataEnd = d.data_end;
				}
			})
			.catch(() => {
				if (req === detailReq) {
					dataStart = null;
					dataEnd = null;
				}
			});
	});

	// Default the example window to the most recent 30 days of available data, so the call
	// actually returns rows. Falls back to "the last 30 days" when the extent is unknown.
	const windowEnd = $derived(dataEnd ? new Date(dataEnd) : new Date());
	const windowStart = $derived.by(() => {
		const back = new Date(windowEnd.getTime() - 30 * 864e5);
		if (dataStart) {
			const ds = new Date(dataStart);
			return ds > back ? ds : back;
		}
		return back;
	});
	const rangeValue = $derived(`start=${isoZ(windowStart)}&end=${isoZ(windowEnd)}`);
	const rangeLabel = $derived(`${isoZ(windowStart).slice(0, 10)} → ${isoZ(windowEnd).slice(0, 10)}`);
	const fullExtentLabel = $derived(
		dataStart && dataEnd ? `${dataStart.slice(0, 10)} → ${dataEnd.slice(0, 10)}` : null
	);

	function paramLabel(sp: SiteParameter): string {
		return sp.name ?? paramNames[sp.parameter_id] ?? sp.parameter_id.slice(0, 8) + '…';
	}

	const siteIdValue = $derived(siteId || '<site-id>');
	const paramIdValue = $derived(paramId || '<parameter-id>');
	const projectIdValue = $derived(
		projectScope || sites.find((s) => s.id === siteId)?.project_id || '<project-id>'
	);
	const hasRealSite = $derived(siteId !== '');

	function fill(s: string): string {
		return s
			.replaceAll('<range>', rangeValue)
			.replaceAll('<now>', nowIso)
			.replaceAll('<site-id>', siteIdValue)
			.replaceAll('<parameter-id>', paramIdValue)
			.replaceAll('<project-id>', projectIdValue);
	}

	type Example = {
		id: string;
		label: string;
		requires: keyof TokenPermissions;
		method: 'GET' | 'POST';
		path: string;
		body?: unknown;
		/** Example uses a parameter id, so offer the parameter picker. */
		usesParam?: boolean;
		/** Example uses a time range, so show the data-extent note. */
		usesRange?: boolean;
	};

	const ALL: Example[] = [
		{ id: 'list-sites', label: 'List sites', requires: 'read_metadata', method: 'GET', path: '/sites' },
		{
			id: 'create-site',
			label: 'Add a new site',
			requires: 'write_metadata',
			method: 'POST',
			path: '/sites',
			body: { project_id: '<project-id>', name: 'New Site', latitude: 46.1, longitude: 7.07 },
		},
		{ id: 'readings', label: 'Get readings from a site', requires: 'read_data', method: 'GET', path: '/sites/<site-id>/readings?<range>', usesRange: true },
		{ id: 'aggregates', label: 'Get daily aggregates', requires: 'read_data', method: 'GET', path: '/sites/<site-id>/aggregates/daily?<range>', usesRange: true },
		{ id: 'alarms', label: 'Get site alarms', requires: 'read_data', method: 'GET', path: '/sites/<site-id>/alarms?<range>', usesRange: true },
		{
			id: 'ingest',
			label: 'Push a reading',
			requires: 'write_data',
			method: 'POST',
			path: '/readings/batch',
			usesParam: true,
			body: { readings: [{ site_id: '<site-id>', parameter_id: '<parameter-id>', time: '<now>', raw_value: 12.3 }] },
		},
	];

	const examples = $derived(ALL.filter((e) => permissions[e.requires]));
	let exampleId = $state('list-sites');
	$effect(() => {
		if (examples.length && !examples.some((e) => e.id === exampleId)) exampleId = examples[0].id;
	});
	const ex = $derived(examples.find((e) => e.id === exampleId) ?? examples[0]);
	const showParamPicker = $derived(!!ex?.usesParam && siteParams.length > 0);
	const showRangeNote = $derived(!!ex?.usesRange);

	function curl(url: string, method: string, body: string): string {
		if (method === 'GET') return `curl -H "Authorization: Bearer ${tokenValue}" \\\n  "${url}"`;
		return (
			`curl -X POST \\\n` +
			`  -H "Authorization: Bearer ${tokenValue}" \\\n` +
			`  -H "Content-Type: application/json" \\\n` +
			`  -d '${body}' \\\n  "${url}"`
		);
	}

	function python(url: string, method: string, bodyPretty: string): string {
		const head = `import requests\n\nTOKEN = "${tokenValue}"`;
		if (method === 'GET')
			return `${head}\n\nr = requests.get(\n    "${url}",\n    headers={"Authorization": f"Bearer {TOKEN}"},\n)\nr.raise_for_status()\nprint(r.json())`;
		return `${head}\n\npayload = ${bodyPretty}\n\nr = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},\n    json=payload,\n)\nr.raise_for_status()\nprint(r.json())`;
	}

	function rlang(url: string, method: string, body: string): string {
		const head = `library(httr)\n\ntoken <- "${tokenValue}"`;
		if (method === 'GET')
			return `${head}\n\nr <- GET(\n  "${url}",\n  add_headers(Authorization = paste("Bearer", token))\n)\ncontent(r)`;
		return `${head}\n\nbody <- '${body}'\n\nr <- POST(\n  "${url}",\n  add_headers(Authorization = paste("Bearer", token), \`Content-Type\` = "application/json"),\n  body = body\n)\ncontent(r)`;
	}

	const code = $derived.by(() => {
		if (!ex) return '';
		const url = fill(`${apiBase}${ex.path}`);
		const body = ex.body ? fill(JSON.stringify(ex.body)) : '';
		const bodyPretty = ex.body ? fill(JSON.stringify(ex.body, null, 4)) : '';
		if (lang === 0) return curl(url, ex.method, body);
		if (lang === 1) return python(url, ex.method, bodyPretty);
		return rlang(url, ex.method, body);
	});
</script>

<div class="space-y-3">
	{#if examples.length === 0}
		<p class="text-sm text-brand-muted">This key has no read or write capabilities, so there's nothing to call yet.</p>
	{:else}
		{#if allowPaste}
			<!-- Paste the key to embed it into the snippets (replaces YOUR_API_TOKEN). -->
			<div class="flex flex-col gap-1">
				<label for="paste-key" class="flex items-center gap-2">
					<span class="text-xs text-brand-muted">Paste your key to embed it (replaces <code class="bg-brand-bg px-1 rounded">YOUR_API_TOKEN</code>)</span>
				</label>
				<div class="flex items-center gap-2">
					<input
						id="paste-key"
						type="text"
						bind:value={pastedToken}
						placeholder="rvd_…"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						class="flex-1 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm font-mono"
					/>
					{#if pastedToken}
						<button type="button" onclick={() => (pastedToken = '')} class="text-xs px-2 py-1 border border-brand-divider rounded hover:bg-brand-bg cursor-pointer">Clear</button>
					{/if}
				</div>
				{#if pastedToken && !pasteLooksValid}
					<span class="text-xs text-severity-warning">That doesn't look like a full <span class="font-mono">rvd_&lt;16 hex&gt;_&lt;64 hex&gt;</span> key - it's still embedded as typed.</span>
				{/if}
				<span class="text-xs text-brand-muted">Stays in this browser tab - never saved or sent anywhere.</span>
			</div>
		{/if}

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

		<!-- Real ids to substitute into the snippet -->
		{#if sites.length}
			<div class="flex flex-wrap items-center gap-3 text-xs">
				<label class="flex items-center gap-1.5">
					<span class="text-brand-muted">Site</span>
					<select bind:value={siteId} class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface">
						{#each sites as s}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				{#if showParamPicker}
					<label class="flex items-center gap-1.5">
						<span class="text-brand-muted">Parameter</span>
						<select bind:value={paramId} class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface">
							{#each siteParams as sp}<option value={sp.parameter_id}>{paramLabel(sp)}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
		{/if}

		<!-- Language tabs -->
		<Tabs tabs={LANGS} bind:active={lang} />

		<!-- Snippet -->
		<div class="relative">
			<pre class="bg-brand-bg border border-brand-divider rounded-md p-3 pr-20 text-xs font-mono overflow-x-auto whitespace-pre">{code}</pre>
			<div class="absolute top-2 right-2"><CopyButton text={code} small /></div>
		</div>

		{#if showRangeNote}
			<p class="text-xs text-brand-muted">
				Dates default to the latest 30 days of data ({rangeLabel}).{#if fullExtentLabel}
					Full stored range for this site: <span class="font-mono">{fullExtentLabel}</span>.{/if}
				There is no range limit - widen the window, or drop <code class="bg-brand-bg px-1 rounded">start</code> /
				<code class="bg-brand-bg px-1 rounded">end</code> entirely to fetch the whole series. Timestamps are
				ISO 8601 UTC; a non-existent calendar date (e.g. <code class="bg-brand-bg px-1 rounded">2026-04-31</code>)
				is rejected as out of range.
			</p>
		{/if}

		{#if usingPlaceholder}
			<p class="text-xs text-brand-muted">
				{#if allowPaste}Paste your key above to embed it, or replace{:else}Replace{/if}
				<code class="bg-brand-bg px-1 rounded">YOUR_API_TOKEN</code> with your key.{#if !hasRealSite}
					Fill <code class="bg-brand-bg px-1 rounded">&lt;site-id&gt;</code> /
					<code class="bg-brand-bg px-1 rounded">&lt;parameter-id&gt;</code> with ids from the list-sites
					response.{/if}
			</p>
		{:else if allowPaste}
			<p class="text-xs text-brand-muted">
				Your pasted key is embedded in the snippet above.{#if hasRealSite}
					Switch the site or parameter above to change the ids.{/if}
			</p>
		{:else}
			<p class="text-xs text-brand-muted">
				Your key is embedded above for copy-paste - this is the only time it is shown.{#if hasRealSite}
					The example is filled with real ids; switch the site or parameter above to change them.{/if}
			</p>
		{/if}
	{/if}
</div>
