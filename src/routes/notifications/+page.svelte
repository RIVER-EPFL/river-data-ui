<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$auth/keycloak.svelte';
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
	import { api, type Site, type Parameter, type NotificationLog, type NotificationMute } from '$api/crud';
	import Tabs from '$components/ui/Tabs.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	const ready = $derived(auth.state.status !== 'loading');
	const isAdmin = $derived(auth.role === 'admin');

	const TABS = ['Status', 'Subscribers', 'Mutes', 'Log'];
	const TAB_KEYS = ['status', 'subscribers', 'mutes', 'log'];

	function tabFromParam(): number {
		const raw = page.url.searchParams.get('tab');
		const i = TAB_KEYS.indexOf(raw ?? '');
		return i >= 0 ? i : 0;
	}
	let activeTab = $state<number>(tabFromParam());

	// Keep ?tab in the URL when the user switches tabs (so refresh / back / shared links restore it).
	$effect(() => {
		const t = activeTab;
		untrack(() => {
			const url = new URL(page.url);
			const key = TAB_KEYS[t] ?? 'status';
			if (url.searchParams.get('tab') !== key) {
				url.searchParams.set('tab', key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	// ── Lookups shared by Mutes tab ──
	let sites = $state<Site[]>([]);
	let parameters = $state<Parameter[]>([]);
	const siteName = $derived(new Map(sites.map((s) => [s.id, s.name])));
	const paramName = $derived(new Map(parameters.map((p) => [p.id, p.name])));

	// ── Status tab ──
	let caps = $state<NotificationsConfig | null>(null);
	let channels = $state<ChannelHealth[]>([]);
	let healthError = $state<string | null>(null);
	let refreshing = $state(false);
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	const telegramHealth = $derived(channels.find((c) => c.name === 'telegram') ?? null);
	const emailHealth = $derived(channels.find((c) => c.name === 'email') ?? null);

	// Per-channel test-send recipient inputs + busy state.
	let testRecipient = $state<{ telegram: string; email: string }>({ telegram: '', email: '' });
	let testBusy = $state<{ telegram: boolean; email: boolean }>({ telegram: false, email: false });

	async function loadHealth() {
		try {
			channels = (await getNotificationsHealth()).channels;
			healthError = null;
		} catch (e) {
			healthError = e instanceof Error ? e.message : 'Failed to load channel health';
		}
	}

	async function doRefreshHealth() {
		refreshing = true;
		try {
			channels = (await refreshNotificationsHealth()).channels;
			healthError = null;
			toastStore.success('Health refreshed');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Refresh failed');
		} finally {
			refreshing = false;
		}
	}

	async function doTestSend(channel: 'telegram' | 'email') {
		const recipient = testRecipient[channel].trim();
		if (!recipient) {
			toastStore.error('Enter a recipient first');
			return;
		}
		testBusy = { ...testBusy, [channel]: true };
		try {
			const res = await testSend({ channel, recipient });
			if (res.allSent) {
				toastStore.success(`Test ${channel} message sent`);
			} else {
				const firstError = res.results.find((r) => r.status === 'failed')?.error;
				toastStore.error(firstError ? `Test failed: ${firstError}` : 'Test message failed');
			}
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Test send failed');
		} finally {
			testBusy = { ...testBusy, [channel]: false };
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

	async function loadSubscribers() {
		try {
			subscribers = await getNotificationSubscribers();
			subscribersError = null;
		} catch (e) {
			subscribersError = e instanceof Error ? e.message : 'Failed to load subscribers';
		} finally {
			subscribersLoaded = true;
		}
	}

	const telegramLinkBadge: Record<NotificationSubscriber['telegram_status'], 'ok' | 'warning' | 'muted'> = {
		linked: 'ok',
		pending: 'warning',
		unlinked: 'muted',
	};

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
			const days = muteDays.trim() ? Number(muteDays) : null;
			const expires_at =
				days != null && Number.isFinite(days) && days > 0
					? new Date(Date.now() + days * 864e5).toISOString()
					: null;
			await api.notificationMutes.create({
				site_id: muteSiteId,
				parameter_id: muteParameterId,
				expires_at,
			});
			toastStore.success('Slot muted');
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

	// ── Log tab ──
	const logPerPage = 50;
	let logs = $state<NotificationLog[]>([]);
	let logTotal = $state(0);
	let logPage = $state(1);
	let logLoading = $state(false);
	let logError = $state<string | null>(null);

	let fKind = $state('');
	let fChannel = $state('');
	let fStatus = $state('');

	async function loadLogs() {
		logLoading = true;
		logError = null;
		try {
			const filter: Record<string, unknown> = {};
			if (fKind) filter.kind = fKind;
			if (fChannel) filter.channel = fChannel;
			if (fStatus) filter.status = fStatus;
			const r = await api.notificationLogs.list({
				page: logPage,
				perPage: logPerPage,
				sort: ['created_at', 'DESC'],
				filter,
			});
			logs = r.data;
			logTotal = r.total;
		} catch (e) {
			logError = e instanceof Error ? e.message : 'Failed to load notification log';
			logs = [];
			logTotal = 0;
		} finally {
			logLoading = false;
		}
	}

	function applyLogFilters() {
		logPage = 1;
		loadLogs();
	}

	// Load each tab's data lazily the first time it's shown (Status loads eagerly + polls).
	$effect(() => {
		const t = activeTab;
		untrack(() => {
			if (t === 1 && !subscribersLoaded) loadSubscribers();
			if (t === 2 && !mutesLoaded) loadMutes();
			if (t === 3 && logs.length === 0 && !logLoading && logError === null) loadLogs();
		});
	});

	onMount(async () => {
		if (!isAdmin) return;
		try {
			caps = await getNotificationsConfig();
		} catch (e) {
			healthError = e instanceof Error ? e.message : 'Failed to load channel capabilities';
		}
		await loadHealth();
		pollInterval = setInterval(loadHealth, 30_000);
		// Lookups are needed by the Mutes tab's joins + selects.
		try {
			const [s, p] = await Promise.all([
				api.sites.list({ perPage: 1000 }),
				api.parameters.list({ perPage: 1000 }),
			]);
			sites = s.data;
			parameters = p.data;
		} catch {
			/* lookups are best-effort; tables fall back to ids */
		}
	});

	onDestroy(() => clearInterval(pollInterval));

	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
	const inputCls =
		'px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
</script>

<svelte:head><title>Notifications | River Data</title></svelte:head>

{#snippet channelCard(
	name: 'telegram' | 'email',
	title: string,
	available: boolean,
	envHint: string,
	health: ChannelHealth | null,
)}
	<div class="rounded-md border border-brand-divider bg-brand-surface p-4 {available ? '' : 'opacity-50'}">
		<div class="flex items-center justify-between gap-3 mb-2">
			<h3 class="text-sm font-semibold">{title}</h3>
			{#if available}
				{@const b = healthBadge(health)}
				<Badge variant={b.variant}>{b.label}</Badge>
			{:else}
				<Badge variant="muted">Unavailable</Badge>
			{/if}
		</div>

		{#if !available}
			<p class="text-sm text-brand-muted">
				Not configured — set <code class="font-mono">{envHint}</code> on the server.
			</p>
		{:else}
			<div class="text-sm text-brand-muted space-y-1">
				{#if name === 'telegram' && caps?.telegram.botUsername}
					<div>Bot: <span class="font-mono text-brand-text">@{caps.telegram.botUsername}</span></div>
				{/if}
				{#if name === 'email'}
					<div>Backend: <span class="font-mono text-brand-text">{caps?.email.backend ?? 'unknown'}</span></div>
				{/if}
				{#if health?.detail}
					<div>{health.detail}</div>
				{/if}
				<div>
					{#if health?.checkedAt}
						Checked {formatRelativeTime(health.checkedAt)}
					{:else}
						Not probed yet
					{/if}
				</div>
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-2">
				<input
					type="text"
					bind:value={testRecipient[name]}
					placeholder={name === 'telegram' ? 'Chat id' : 'Email address'}
					class="{inputCls} flex-1 min-w-[12rem]"
				/>
				<Button size="sm" disabled={testBusy[name]} onclick={() => doTestSend(name)}>
					{testBusy[name] ? 'Sending…' : 'Send test'}
				</Button>
			</div>
		{/if}
	</div>
{/snippet}

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
		<Tabs tabs={TABS} bind:active={activeTab} />

		<!-- ── STATUS TAB ── -->
		{#if activeTab === 0}
			{#if healthError}
				<ErrorNotice message={healthError} />
			{/if}
			<div class="flex justify-end">
				<Button disabled={refreshing} onclick={doRefreshHealth}>
					{refreshing ? 'Refreshing…' : 'Refresh health'}
				</Button>
			</div>
			<div class="grid gap-4 md:grid-cols-2">
				{@render channelCard(
					'telegram',
					'Telegram',
					caps?.telegram.available ?? false,
					'TELEGRAM_BOT_TOKEN',
					telegramHealth,
				)}
				{@render channelCard(
					'email',
					'Email',
					caps?.email.available ?? false,
					'EMAIL_BACKEND (+ credentials)',
					emailHealth,
				)}
			</div>

		<!-- ── SUBSCRIBERS TAB ── -->
		{:else if activeTab === 1}
			{#if subscribersError}
				<ErrorNotice message={subscribersError} />
			{/if}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">User</th>
							<th class="text-left px-4 py-2 font-semibold">Email</th>
							<th class="text-left px-4 py-2 font-semibold">Telegram</th>
							<th class="text-left px-4 py-2 font-semibold">Link</th>
							<th class="text-left px-4 py-2 font-semibold">Overrides</th>
							<th class="text-left px-4 py-2 font-semibold">Active</th>
						</tr>
					</thead>
					<tbody>
						{#if !subscribersLoaded}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
						{:else if subscribers.length === 0}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No subscribers yet.</td></tr>
						{:else}
							{#each subscribers as s (s.keycloak_sub)}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2 font-mono text-xs break-all">{s.keycloak_sub}</td>
									<td class="px-4 py-2">
										{#if s.email_enabled}<Badge variant="ok">On</Badge>{:else}<Badge variant="muted">Off</Badge>{/if}
									</td>
									<td class="px-4 py-2">
										{#if s.telegram_enabled}<Badge variant="ok">On</Badge>{:else}<Badge variant="muted">Off</Badge>{/if}
									</td>
									<td class="px-4 py-2"><Badge variant={telegramLinkBadge[s.telegram_status]}>{s.telegram_status}</Badge></td>
									<td class="px-4 py-2">{s.subscription_overrides}</td>
									<td class="px-4 py-2">
										{#if s.is_active}<Badge variant="ok">Active</Badge>{:else}<Badge variant="muted">Inactive</Badge>{/if}
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

		<!-- ── MUTES TAB ── -->
		{:else if activeTab === 2}
			{#if mutesError}
				<ErrorNotice message={mutesError} />
			{/if}
			<div class="flex justify-end">
				<Button variant="primary" onclick={openMuteDialog}>Mute a slot</Button>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
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
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No mutes. Every (site, parameter) slot can alert.</td></tr>
						{:else}
							{#each mutes as m (m.id)}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2">{siteName.get(m.site_id) ?? m.site_id.slice(0, 8) + '…'}</td>
									<td class="px-4 py-2 font-semibold">{paramName.get(m.parameter_id) ?? m.parameter_id.slice(0, 8) + '…'}</td>
									<td class="px-4 py-2">
										{#if m.expires_at}{formatDateTime(m.expires_at)}{:else}<span class="text-brand-muted">Permanent</span>{/if}
									</td>
									<td class="px-4 py-2 text-brand-muted">{m.created_by ?? '—'}</td>
									<td class="px-4 py-2 text-brand-muted">{formatDateTime(m.created_at)}</td>
									<td class="px-4 py-2">
										<div class="flex justify-end">
											<ConfirmPopover message="Remove this mute? The slot will alert again." confirmLabel="Remove" onconfirm={() => deleteMute(m.id)}>
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
		{:else if activeTab === 3}
			<div class="flex flex-wrap items-end gap-3">
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Kind
					<select bind:value={fKind} onchange={applyLogFilters} class={selectCls}>
						<option value="">Any</option>
						<option value="alarm">alarm</option>
						<option value="test">test</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Channel
					<select bind:value={fChannel} onchange={applyLogFilters} class={selectCls}>
						<option value="">Any</option>
						<option value="telegram">telegram</option>
						<option value="email">email</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Status
					<select bind:value={fStatus} onchange={applyLogFilters} class={selectCls}>
						<option value="">Any</option>
						<option value="sent">sent</option>
						<option value="failed">failed</option>
					</select>
				</label>
			</div>

			{#if logError}
				<ErrorNotice message={logError} />
			{/if}

			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">Time</th>
							<th class="text-left px-4 py-2 font-semibold">Kind</th>
							<th class="text-left px-4 py-2 font-semibold">Channel</th>
							<th class="text-left px-4 py-2 font-semibold">Recipient</th>
							<th class="text-left px-4 py-2 font-semibold">Status</th>
							<th class="text-left px-4 py-2 font-semibold">Error</th>
						</tr>
					</thead>
					<tbody>
						{#if logLoading}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
						{:else if logs.length === 0}
							<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No matching deliveries.</td></tr>
						{:else}
							{#each logs as l (l.id)}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="whitespace-nowrap px-4 py-2 text-brand-muted">{formatDateTime(l.created_at)}</td>
									<td class="px-4 py-2">{l.kind}</td>
									<td class="px-4 py-2"><Badge variant="default">{l.channel}</Badge></td>
									<td class="px-4 py-2 font-mono text-xs break-all">{l.recipient}</td>
									<td class="px-4 py-2">
										{#if l.status === 'sent'}<Badge variant="ok">sent</Badge>{:else}<Badge variant="alarm">{l.status}</Badge>{/if}
									</td>
									<td class="px-4 py-2 max-w-xs truncate text-brand-muted" title={l.error ?? ''}>{l.error ?? '—'}</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<PaginationControls
				total={logTotal}
				page={logPage}
				perPage={logPerPage}
				onPageChange={(p) => { logPage = p; loadLogs(); }}
			/>
		{/if}
	{/if}
</div>

<!-- Mute a slot -->
<Dialog bind:open={muteDialogOpen} title="Mute a slot" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<label class="block text-sm">
				<span class="text-brand-muted">Site</span>
				<select bind:value={muteSiteId} class="mt-1 w-full {selectCls}">
					<option value="">Select a site…</option>
					{#each sites as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</label>
			<label class="block text-sm">
				<span class="text-brand-muted">Parameter</span>
				<select bind:value={muteParameterId} class="mt-1 w-full {selectCls}">
					<option value="">Select a parameter…</option>
					{#each parameters as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>
			<label class="block text-sm">
				<span class="text-brand-muted">Mute for (days)</span>
				<input type="number" min="1" bind:value={muteDays} placeholder="Leave blank for permanent" class="mt-1 w-full {inputCls}" />
			</label>
			<p class="text-xs text-brand-muted">Leave the days field blank to mute this slot permanently.</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (muteDialogOpen = false)}>Cancel</Button>
		<Button variant="primary" disabled={muteSaving} onclick={saveMute}>{muteSaving ? 'Saving…' : 'Mute'}</Button>
	{/snippet}
</Dialog>
