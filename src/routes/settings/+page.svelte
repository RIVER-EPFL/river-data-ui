<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import {
		getNotificationsConfig,
		getMyNotifications,
		updateMyNotifications,
		setMySubscriptions,
		registerPushSubscription,
		testMyPush,
		scheduleMyPing,
		type NotificationsConfig,
		type MyNotifications,
	} from '$api/service';
	import { api, type Project, type Site } from '$api/crud';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import {
		isWebPushSupported,
		isIOSSafari,
		isStandalonePWA,
		subscribe,
		getSubscription,
		unsubscribe,
		subscriptionToPayload,
	} from '$lib/push';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let caps = $state<NotificationsConfig | null>(null);
	let me = $state<MyNotifications | null>(null);
	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state(false);

	let pushSupported = $state(false);
	let pushSubscribed = $state(false);
	let iosNeedsInstall = $state(false);
	let pingSeconds = $state(10);
	let testBusy = $state(false);

	let mutedSites = $state<Set<string>>(new Set());

	const sitesByProject = $derived.by(() => {
		const m = new Map<string, Site[]>();
		for (const s of sites) {
			const list = m.get(s.project_id) ?? [];
			list.push(s);
			m.set(s.project_id, list);
		}
		return m;
	});

	function deriveMuted(n: MyNotifications) {
		const siteOverride = new Map<string, boolean>();
		const projectOverride = new Map<string, boolean>();
		for (const s of n.subscriptions) {
			if (s.site_id && !s.parameter_id) siteOverride.set(s.site_id, s.enabled);
			else if (s.project_id && !s.site_id) projectOverride.set(s.project_id, s.enabled);
		}
		const muted = new Set<string>();
		for (const site of sites) {
			const effective =
				siteOverride.get(site.id) ?? projectOverride.get(site.project_id) ?? true;
			if (!effective) muted.add(site.id);
		}
		return muted;
	}

	onMount(async () => {
		pushSupported = isWebPushSupported();
		iosNeedsInstall = isIOSSafari() && !isStandalonePWA();

		try {
			caps = await getNotificationsConfig();
			const [n, p, s] = await Promise.all([
				getMyNotifications(),
				api.projects.list({ perPage: 500 }),
				api.sites.list({ perPage: 1000 }),
			]);
			me = n;
			projects = p.data;
			sites = s.data;
			mutedSites = deriveMuted(n);

			if (pushSupported) {
				const sub = await getSubscription();
				pushSubscribed = !!sub;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load notification settings';
		} finally {
			loading = false;
		}
	});

	async function togglePush(enabled: boolean) {
		busy = true;
		try {
			me = await updateMyNotifications({ web_push_enabled: enabled });
			toastStore.success(enabled ? 'Push notifications enabled' : 'Push notifications disabled');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Update failed');
		} finally {
			busy = false;
		}
	}

	async function enablePush() {
		if (!caps?.webPush.vapidPublicKey) return;
		busy = true;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				toastStore.error('Notification permission was denied');
				return;
			}
			const sub = await subscribe(caps.webPush.vapidPublicKey);
			await registerPushSubscription(subscriptionToPayload(sub));
			pushSubscribed = true;
			toastStore.success('Push notifications active on this device');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to enable push notifications');
		} finally {
			busy = false;
		}
	}

	async function sendTest() {
		testBusy = true;
		try {
			await testMyPush();
			toastStore.success('Test notification sent');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Test failed');
		} finally {
			testBusy = false;
		}
	}

	async function sendPing() {
		testBusy = true;
		try {
			const res = await scheduleMyPing(pingSeconds);
			toastStore.success(`Ping scheduled in ${res.seconds} second${res.seconds === 1 ? '' : 's'}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Scheduling failed');
		} finally {
			testBusy = false;
		}
	}

	async function disablePush() {
		busy = true;
		try {
			await unsubscribe();
			pushSubscribed = false;
			toastStore.success('Push notifications disabled on this device');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to disable push');
		} finally {
			busy = false;
		}
	}

	function toggleSite(siteId: string, on: boolean) {
		const next = new Set(mutedSites);
		if (on) next.delete(siteId);
		else next.add(siteId);
		mutedSites = next;
	}

	function toggleProject(projectId: string, on: boolean) {
		const next = new Set(mutedSites);
		for (const site of sitesByProject.get(projectId) ?? []) {
			if (on) next.delete(site.id);
			else next.add(site.id);
		}
		mutedSites = next;
	}

	async function saveSubscriptions() {
		busy = true;
		try {
			const overrides = [...mutedSites].map((site_id) => ({ site_id, enabled: false }));
			me = await setMySubscriptions(overrides);
			mutedSites = deriveMuted(me);
			toastStore.success('Subscriptions saved');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			busy = false;
		}
	}

	const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
</script>

<div class="max-w-3xl mx-auto">
	<h1 class="text-xl font-semibold text-brand-text mb-1">Settings</h1>
	<p class="text-sm text-brand-text-muted mb-6">Manage how times are shown and how you receive alerts from River Data.</p>

	<section class="mb-8">
		<h2 class="text-lg font-medium text-brand-text mb-3">Display</h2>
		<div class="border border-brand-divider rounded-lg p-4">
			<div class="flex items-center justify-between gap-4">
				<div>
					<div class="font-medium text-brand-text">Time zone</div>
					<div class="text-sm text-brand-text-muted">
						How dates and times are shown across charts, tables, and pickers. Data is always
						stored in UTC; this only changes the display. Your browser zone is
						<span class="font-mono">{browserZone}</span>.
					</div>
				</div>
				<div class="flex shrink-0 rounded-md border border-brand-divider overflow-hidden text-sm">
					<button
						class="px-3 py-1.5 {timezoneStore.mode === 'local'
							? 'bg-brand-primary text-white'
							: 'text-brand-text hover:bg-brand-bg'}"
						onclick={() => timezoneStore.set('local')}
					>
						Local
					</button>
					<button
						class="px-3 py-1.5 border-l border-brand-divider {timezoneStore.mode === 'utc'
							? 'bg-brand-primary text-white'
							: 'text-brand-text hover:bg-brand-bg'}"
						onclick={() => timezoneStore.set('utc')}
					>
						UTC
					</button>
				</div>
			</div>
		</div>
	</section>

	{#if loading}
		<p class="text-brand-text-muted">Loading…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else if me && caps}
		<section class="mb-8">
			<h2 class="text-lg font-medium text-brand-text mb-3">Notifications</h2>

			<!-- Push notifications -->
			<div class="border border-brand-divider rounded-lg p-4 mb-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<div class="font-medium text-brand-text">Push notifications</div>
						<div class="text-sm text-brand-text-muted">
							{#if !caps.webPush.available}
								Unavailable — the server has no VAPID key configured.
							{:else if !pushSupported}
								Your browser does not support push notifications.
							{:else if iosNeedsInstall}
								To receive push notifications on iOS, add this site to your Home Screen first:
								tap the Share button, then "Add to Home Screen".
							{:else if pushSubscribed}
								Active on this device.
							{:else}
								Enable to receive alarm alerts on this device.
							{/if}
						</div>
					</div>
					<label class="flex items-center gap-2 shrink-0">
						<input
							type="checkbox"
							class="w-4 h-4"
							checked={me.webPushEnabled}
							disabled={busy || !caps.webPush.available}
							onchange={(e) => togglePush(e.currentTarget.checked)}
						/>
						<span class="text-sm">Enabled</span>
					</label>
				</div>

				{#if caps.webPush.available && pushSupported && !iosNeedsInstall}
					<div class="mt-3 pt-3 border-t border-brand-divider flex flex-wrap items-center gap-3">
						{#if pushSubscribed}
							<Badge variant="ok">Active on this device</Badge>
							<Button size="sm" variant="secondary" disabled={busy} onclick={disablePush}>
								Disable on this device
							</Button>
						{:else}
							<Button size="sm" disabled={busy} onclick={enablePush}>
								Enable on this device
							</Button>
							<span class="text-sm text-brand-text-muted">
								{me.pushSubscriptionCount} device{me.pushSubscriptionCount === 1 ? '' : 's'} registered
							</span>
						{/if}
					</div>

					{#if pushSubscribed}
						<div class="mt-3 pt-3 border-t border-brand-divider flex flex-wrap items-center gap-3">
							<Button size="sm" variant="secondary" disabled={testBusy} onclick={sendTest}>
								Send test
							</Button>
							<div class="flex items-center gap-2">
								<Button size="sm" variant="secondary" disabled={testBusy} onclick={sendPing}>
									Ping me in
								</Button>
								<input
									type="number"
									min="5"
									max="3600"
									bind:value={pingSeconds}
									class="w-16 text-sm border border-brand-divider rounded px-2 py-1 bg-brand-surface text-brand-text"
								/>
								<span class="text-sm text-brand-text-muted">sec</span>
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Subscriptions -->
			<div class="border border-brand-divider rounded-lg p-4">
				<div class="flex items-center justify-between mb-1">
					<div class="font-medium text-brand-text">Which sites alert you</div>
					<Button size="sm" disabled={busy} onclick={saveSubscriptions}>Save</Button>
				</div>
				<p class="text-sm text-brand-text-muted mb-3">
					You receive alerts for every site by default. Uncheck the ones you don't want.
				</p>

				{#if projects.length === 0}
					<p class="text-sm text-brand-text-muted">No sites available.</p>
				{:else}
					<div class="space-y-3">
						{#each projects as project (project.id)}
							{@const projectSites = sitesByProject.get(project.id) ?? []}
							{#if projectSites.length > 0}
								{@const allOn = projectSites.every((s) => !mutedSites.has(s.id))}
								<div>
									<label class="flex items-center gap-2 font-medium text-brand-text">
										<input
											type="checkbox"
											class="w-4 h-4"
											checked={allOn}
											onchange={(e) => toggleProject(project.id, e.currentTarget.checked)}
										/>
										{project.name}
									</label>
									<div class="ml-6 mt-1 space-y-1">
										{#each projectSites as site (site.id)}
											<label class="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													class="w-4 h-4"
													checked={!mutedSites.has(site.id)}
													onchange={(e) => toggleSite(site.id, e.currentTarget.checked)}
												/>
												{site.name}
											</label>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>
