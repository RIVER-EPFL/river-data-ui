<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, formatRelativeTime } from '$lib/utils';
	import {
		getNotificationsConfig,
		getNotificationsHealth,
		refreshNotificationsHealth,
		testSend,
		getNotificationSubscribers,
		type NotificationsConfig,
		type ChannelHealth,
		type NotificationSubscriber,
	} from '$api/service';
	import { api, type Parameter, type NotificationMute, type RealmUser } from '$api/crud';
	import Tabs from '$components/ui/Tabs.svelte';
	import ParameterSelect from '$components/ParameterSelect.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import { siteRefs } from '$lib/siteRefs.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import DeliveryLogPanel from '$components/notifications/DeliveryLogPanel.svelte';

	const ready = $derived(me.status !== 'loading');
	const isAdmin = $derived(me.can('admin'));

	const TABS = ['Status', 'Mutes', 'Delivery log'];
	const tab = createUrlTab({ keys: ['status', 'mutes', 'log'], aliases: { subscribers: 'status' } });

	// ── Lookups shared by Mutes tab ──
	let parameters = $state<Parameter[]>([]);
	const siteName = $derived(new Map(siteRefs.all.map((s) => [s.id, s.name])));
	const paramName = $derived(new Map(parameters.map((p) => [p.id, p.name])));

	// ── Status tab ──
	let caps = $state<NotificationsConfig | null>(null);
	let channels = $state<ChannelHealth[]>([]);
	let deliveryGap = $state<{ noChannel: boolean; undeliverable: number; failed: number } | null>(
		null
	);
	let healthError = $state<string | null>(null);
	let refreshing = $state(false);
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	const webPushHealth = $derived(channels.find((c) => c.name === 'web_push') ?? null);

	let testBusy = $state(false);

	async function loadHealth() {
		try {
			const health = await getNotificationsHealth();
			channels = health.channels;
			deliveryGap = {
				noChannel: health.noChannelConfigured,
				undeliverable: health.undeliverable24h,
				failed: health.failed24h,
			};
			healthError = null;
		} catch (e) {
			healthError = e instanceof Error ? e.message : 'Failed to load channel health';
		}
	}

	async function doRefreshHealth() {
		refreshing = true;
		try {
			const health = await refreshNotificationsHealth();
			channels = health.channels;
			deliveryGap = {
				noChannel: health.noChannelConfigured,
				undeliverable: health.undeliverable24h,
				failed: health.failed24h,
			};
			healthError = null;
			toastStore.success('Health refreshed');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Refresh failed');
		} finally {
			refreshing = false;
		}
	}

	async function doTestSend() {
		testBusy = true;
		try {
			const res = await testSend({ channel: 'web_push', recipient: 'all' });
			if (res.allSent) {
				toastStore.success('Test push notification sent');
			} else {
				const firstError = res.results.find((r) => r.status === 'failed')?.error;
				toastStore.error(firstError ? `Test failed: ${firstError}` : 'Test message failed');
			}
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Test send failed');
		} finally {
			testBusy = false;
		}
	}

	function healthBadge(h: ChannelHealth | null): { variant: 'ok' | 'alarm' | 'muted'; label: string } {
		if (!h || h.healthy === null) return { variant: 'muted', label: 'Not checked yet' };
		return h.healthy ? { variant: 'ok', label: 'Healthy' } : { variant: 'alarm', label: 'Failing' };
	}

	// ── Subscribers tab ──
	let subscribers = $state<NotificationSubscriber[]>([]);
	let subscribersLoaded = $state(false);
	let subscribersError = $state<string | null>(null);

	// The roster is keyed by Keycloak `sub`, which is the realm user id, so the user list resolves
	// every row to a name. Directory lookup is best-effort: a sub with no matching account (a
	// deleted user with a stale identity row) still renders, as the bare sub.
	let subscriberUsers = $state(new Map<string, RealmUser>());

	async function loadSubscribers() {
		try {
			const [roster, users] = await Promise.all([
				getNotificationSubscribers(),
				api.users
					.list({ perPage: 500, sort: ['username', 'ASC'] })
					.then((r) => r.data)
					.catch(() => [] as RealmUser[]),
			]);
			subscribers = roster;
			subscriberUsers = new Map(users.map((u) => [u.id, u]));
			subscribersError = null;
		} catch (e) {
			subscribersError = e instanceof Error ? e.message : 'Failed to load subscribers';
		} finally {
			subscribersLoaded = true;
		}
	}

	function displayName(u: RealmUser | undefined): string {
		return [u?.firstName, u?.lastName].filter(Boolean).join(' ');
	}

	// ── Mutes tab ──
	let mutes = $state<NotificationMute[]>([]);
	let mutesLoaded = $state(false);
	let mutesError = $state<string | null>(null);
	let muteBusy = $state<string | null>(null);

	let muteDialogOpen = $state(false);
	let muteSiteId = $state('');
	let muteParameterId = $state('');
	let muteDays = $state('');
	let muteSaving = $state(false);

	async function loadMutes() {
		try {
			const r = await api.notificationMutes.list({ perPage: 1000, sort: ['created_at', 'DESC'] });
			mutes = r.data;
			mutesError = null;
		} catch (e) {
			mutesError = e instanceof Error ? e.message : 'Failed to load mutes';
		} finally {
			mutesLoaded = true;
		}
	}

	function openMuteDialog() {
		muteSiteId = '';
		muteParameterId = '';
		muteDays = '';
		muteDialogOpen = true;
	}

	async function saveMute() {
		if (!muteSiteId || !muteParameterId) {
			toastStore.error('Pick a site and a parameter');
			return;
		}
		muteSaving = true;
		try {
			const days = String(muteDays).trim() ? Number(muteDays) : null;
			const expires_at =
				days != null && Number.isFinite(days) && days > 0
					? new Date(Date.now() + days * 864e5).toISOString()
					: null;
			await api.notificationMutes.create({
				site_id: muteSiteId,
				parameter_id: muteParameterId,
				expires_at,
			});
			toastStore.success('Site parameter muted');
			muteDialogOpen = false;
			await loadMutes();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to mute');
		} finally {
			muteSaving = false;
		}
	}

	async function deleteMute(id: string) {
		muteBusy = id;
		try {
			await api.notificationMutes.remove(id);
			toastStore.success('Mute removed');
			await loadMutes();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to remove mute');
		} finally {
			muteBusy = null;
		}
	}

	// Load each tab's data lazily the first time it's shown (Status loads eagerly + polls). Gated on
	// admin + a resolved `/api/me`, so a non-admin (or a still-loading session) never fires the
	// admin-only list calls.
	$effect(() => {
		const t = tab.key;
		if (!ready || !isAdmin) return;
		untrack(() => {
			if (t === 'status' && !subscribersLoaded) loadSubscribers();
			if (t === 'mutes' && !mutesLoaded) loadMutes();
		});
	});

	// Bootstrap the admin view once `/api/me` resolves. Using `onMount` read `isAdmin` while the
	// session was still loading (false → early return, nothing re-ran when it resolved), leaving the
	// page blank for admins on a hard load. Keyed on `ready`, this runs when the role is known.
	let bootstrapped = false;
	$effect(() => {
		if (!ready || !isAdmin || bootstrapped) return;
		bootstrapped = true;
		untrack(() => {
			void bootstrapAdmin();
		});
	});

	async function bootstrapAdmin() {
		try {
			caps = await getNotificationsConfig();
		} catch (e) {
			healthError = e instanceof Error ? e.message : 'Failed to load channel capabilities';
		}
		await loadHealth();
		pollInterval = setInterval(loadHealth, 30_000);
		// Lookups are needed by the Mutes tab's joins + selects.
		try {
			const [, p] = await Promise.all([
				siteRefs.ensure(),
				api.parameters.list({ perPage: 1000 }),
			]);
			parameters = p.data;
		} catch {
			/* lookups are best-effort; tables fall back to ids */
		}
	}

	onDestroy(() => clearInterval(pollInterval));

	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
	const inputCls =
		'px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
</script>

<svelte:head><title>Notifications | RIVER Data</title></svelte:head>


<div class="space-y-4">
	<h2 class="text-xl font-semibold">Notifications</h2>

	{#if !ready}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else if !isAdmin}
		<div class="space-y-3 max-w-lg">
			<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
				Administrator role required to oversee notification channels. To manage your own alert
				preferences, use <a href="{base}/settings" class="text-brand-primary no-underline hover:underline">account settings</a>.
			</div>
			<a href="{base}/" class="text-sm text-brand-primary no-underline">&larr; Back to dashboard</a>
		</div>
	{:else}
		<p class="text-sm text-brand-text-muted mb-4">
			Looking for your own notification preferences?
			<a href="{base}/settings" class="text-brand-primary no-underline hover:underline">Go to Settings</a>
		</p>
		<Tabs tabs={TABS} bind:active={tab.index} />

		<!-- ── STATUS TAB ── -->
		{#if tab.key === 'status'}
			{@const available = caps?.webPush.available ?? false}
			{@const health = webPushHealth}

			{#if healthError}
				<ErrorNotice message={healthError} />
			{/if}

			{#if deliveryGap?.noChannel}
				<ErrorNotice
					message="No notification channel is configured, so every alarm is recorded as
						undeliverable and nobody is told. The API is unaffected: notifications never block
						ingestion."
				/>
			{:else if deliveryGap && deliveryGap.undeliverable + deliveryGap.failed > 0}
				<ErrorNotice
					message="{deliveryGap.undeliverable + deliveryGap.failed} notification{deliveryGap.undeliverable +
						deliveryGap.failed ===
					1
						? ''
						: 's'} reached nobody in the last 24 hours."
				/>
			{/if}

			<div class="space-y-4 max-w-xl">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="text-base font-semibold text-brand-text">Web Push</h3>
						{#if available}
							{@const b = healthBadge(health)}
							<Badge variant={b.variant}>{b.label}</Badge>
						{:else}
							<Badge variant="muted">Unavailable</Badge>
						{/if}
					</div>
					<Button size="sm" disabled={refreshing} onclick={doRefreshHealth}>
						{refreshing ? 'Refreshing…' : 'Refresh'}
					</Button>
				</div>

				{#if !available}
					<p class="text-sm text-brand-muted">
						Not configured. Set <code class="font-mono">VAPID_PRIVATE_KEY_PEM</code> on the server.
					</p>
				{:else}
					<div class="text-sm text-brand-muted space-y-1">
						{#if health?.detail}
							<div>{health.detail}</div>
						{/if}
						{#if health?.checkedAt}
							<div>Last checked {formatRelativeTime(health.checkedAt)}</div>
						{/if}
					</div>

					{#if subscribersLoaded}
						{@const activeUsers = subscribers.filter((s) => s.webPushEnabled).length}
						{@const totalDevices = subscribers.reduce((n, s) => n + s.pushSubscriptionCount, 0)}
						<div class="text-sm text-brand-text">
							{activeUsers} user{activeUsers === 1 ? '' : 's'} with push enabled,
							{totalDevices} device{totalDevices === 1 ? '' : 's'} registered.
							<a href="{base}/users" class="text-brand-primary no-underline hover:underline">View users</a>
						</div>
					{/if}

					<div>
						<Button size="sm" disabled={testBusy} onclick={doTestSend}>
							{testBusy ? 'Sending…' : 'Send test notification'}
						</Button>
					</div>
				{/if}
			</div>

		<!-- ── MUTES TAB ── -->
		{:else if tab.key === 'mutes'}
			{#if mutesError}
				<ErrorNotice message={mutesError} />
			{/if}
			<div class="flex justify-end">
				<Button variant="primary" onclick={openMuteDialog}>Mute a site parameter</Button>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">Site</th>
							<th class="text-left px-4 py-2 font-semibold">Parameter</th>
							<th class="text-left px-4 py-2 font-semibold">Expires</th>
							<th class="text-left px-4 py-2 font-semibold">Created by</th>
							<th class="text-left px-4 py-2 font-semibold">Created</th>
							<th class="text-right px-4 py-2 font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#if !mutesLoaded}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
						{:else if mutes.length === 0}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No mutes. Every site parameter can alert.</td></tr>
						{:else}
							{#each mutes as m (m.id)}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2">{siteName.get(m.site_id) ?? m.site_id.slice(0, 8) + '…'}</td>
									<td class="px-4 py-2 font-semibold">{paramName.get(m.parameter_id) ?? m.parameter_id.slice(0, 8) + '…'}</td>
									<td class="px-4 py-2">
										{#if m.expires_at}{formatDateTime(m.expires_at)}{:else}<span class="text-brand-muted">Permanent</span>{/if}
									</td>
									<td class="px-4 py-2 text-brand-muted">{m.created_by ?? '-'}</td>
									<td class="px-4 py-2 text-brand-muted">{formatDateTime(m.created_at)}</td>
									<td class="px-4 py-2">
										<div class="flex justify-end">
											<ConfirmPopover message="Remove this mute? This site parameter will alert again." confirmLabel="Remove" onconfirm={() => deleteMute(m.id)}>
												<Button variant="ghost" size="sm" class="text-severity-alarm" disabled={muteBusy === m.id}>Remove</Button>
											</ConfirmPopover>
										</div>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

		<!-- ── LOG TAB ── -->
		{:else if tab.key === 'log'}
			<DeliveryLogPanel />
		{/if}
	{/if}
</div>

<!-- Mute a site parameter -->
<Dialog bind:open={muteDialogOpen} title="Mute a site parameter" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<label class="block text-sm">
				<span class="text-brand-muted">Site</span>
				<SiteSelect bind:value={muteSiteId} class="mt-1 w-full {selectCls}" />
			</label>
			<label class="block text-sm">
				<span class="text-brand-muted">Parameter</span>
				<ParameterSelect bind:value={muteParameterId} global {parameters} />
			</label>
			<label class="block text-sm">
				<span class="text-brand-muted">Mute for (days)</span>
				<input type="number" min="1" bind:value={muteDays} placeholder="Leave blank for permanent" class="mt-1 w-full {inputCls}" />
			</label>
			<p class="text-xs text-brand-muted">Leave the days field blank to mute this site parameter permanently.</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (muteDialogOpen = false)}>Cancel</Button>
		<Button variant="primary" disabled={muteSaving} onclick={saveMute}>{muteSaving ? 'Saving…' : 'Mute'}</Button>
	{/snippet}
</Dialog>
