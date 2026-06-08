<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$auth/keycloak.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import JobsPanel from '$components/logs/JobsPanel.svelte';
	import AlarmEventsPanel from '$components/logs/AlarmEventsPanel.svelte';
	import ApiAuditPanel from '$components/logs/ApiAuditPanel.svelte';
	import SyncEventsPanel from '$components/logs/SyncEventsPanel.svelte';

	const isAdmin = $derived(auth.role === 'admin');

	type TabDef = { key: string; label: string; adminOnly: boolean };
	const ALL_TABS: TabDef[] = [
		{ key: 'jobs', label: 'Jobs', adminOnly: false },
		{ key: 'alarms', label: 'Alarm Events', adminOnly: false },
		{ key: 'audit', label: 'API Audit', adminOnly: true },
		{ key: 'sync', label: 'Sync Events', adminOnly: true },
	];
	const visibleTabs = $derived(ALL_TABS.filter((t) => !t.adminOnly || isAdmin));
	const tabLabels = $derived(visibleTabs.map((t) => t.label));

	// Deep-link filters for the Alarm Events tab (e.g. from the dashboard).
	const initialSiteId = page.url.searchParams.get('site_id') ?? '';
	const initialSeverity = (() => {
		const s = page.url.searchParams.get('severity');
		if (s === 'warning') return 1;
		if (s === 'alarm') return 2;
		return undefined;
	})();

	// Captured once at mount so reflecting the active tab back to the URL can't clobber the
	// originally requested tab before we've resolved it.
	const initialTabRaw = page.url.searchParams.get('tab');

	// Resolve ?tab (named, with numeric legacy) → an index into the *visible* tab set.
	// Admin-only keys requested by a non-admin fall back to the default (jobs).
	function resolveActive(): number {
		if (initialTabRaw == null) return 0;
		const key = /^\d+$/.test(initialTabRaw) ? (ALL_TABS[Number(initialTabRaw)]?.key ?? 'jobs') : initialTabRaw;
		const idx = visibleTabs.findIndex((t) => t.key === key);
		return idx >= 0 ? idx : 0;
	}

	let active = $state(0);

	// Resolve the initial tab once auth is ready (role known → visibleTabs settled), so an
	// admin deep-linking to ?tab=audit lands correctly even if the page mounts mid-auth.
	const ready = $derived(auth.state.status !== 'loading');
	let initialized = $state(false);
	$effect(() => {
		if (ready && !initialized) {
			initialized = true;
			untrack(() => {
				active = resolveActive();
			});
		}
	});

	const activeKey = $derived(visibleTabs[active]?.key ?? 'jobs');

	// Reflect the active tab back to ?tab (named) for refresh / back / shareable links.
	$effect(() => {
		const key = activeKey;
		if (!initialized) return;
		untrack(() => {
			const url = new URL(page.url);
			if (url.searchParams.get('tab') !== key) {
				url.searchParams.set('tab', key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});
</script>

<svelte:head><title>Logs | River Data</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">Logs</h2>
	<Tabs tabs={tabLabels} bind:active />

	{#if activeKey === 'jobs'}
		<JobsPanel />
	{:else if activeKey === 'alarms'}
		<AlarmEventsPanel {initialSiteId} {initialSeverity} />
	{:else if activeKey === 'audit'}
		<ApiAuditPanel />
	{:else if activeKey === 'sync'}
		<SyncEventsPanel />
	{/if}
</div>
