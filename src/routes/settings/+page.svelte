<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';
	import { auth } from '$auth/keycloak.svelte';
	import { me as meStore } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import {
		getNotificationsConfig,
		getMyNotifications,
		updateMyNotifications,
		setMySubscriptions,
		mintMyLinkCode,
		unlinkMyTelegram,
		type NotificationsConfig,
		type MyNotifications,
	} from '$api/service';
	import { api, type Project, type Site } from '$api/crud';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import CopyButton from '$components/ui/CopyButton.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let caps = $state<NotificationsConfig | null>(null);
	let me = $state<MyNotifications | null>(null);
	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Telegram link code (only held in memory right after minting, never returned by GET).
	let linkCode = $state<string | null>(null);
	let busy = $state(false);

	// Sites the user has turned OFF (default is on). Saved as site-level enabled=false overrides.
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
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load notification settings';
		} finally {
			loading = false;
		}
	});

	async function toggleEmail(enabled: boolean) {
		busy = true;
		try {
			me = await updateMyNotifications({ email_enabled: enabled });
			toastStore.success(enabled ? 'Email alerts enabled' : 'Email alerts disabled');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Update failed');
		} finally {
			busy = false;
		}
	}

	async function toggleTelegram(enabled: boolean) {
		busy = true;
		try {
			me = await updateMyNotifications({ telegram_enabled: enabled });
			toastStore.success(enabled ? 'Telegram alerts enabled' : 'Telegram alerts disabled');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Update failed');
		} finally {
			busy = false;
		}
	}

	async function togglePin(exempt: boolean) {
		busy = true;
		try {
			me = await updateMyNotifications({ expiry_exempt: exempt });
			toastStore.success(
				exempt ? 'Link pinned, it will not expire' : 'Link unpinned, idle expiry applies',
			);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Update failed');
		} finally {
			busy = false;
		}
	}

	async function linkTelegram() {
		busy = true;
		try {
			const res = await mintMyLinkCode();
			linkCode = res.code;
			me = await getMyNotifications();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not generate a link code');
		} finally {
			busy = false;
		}
	}

	async function unlink() {
		busy = true;
		try {
			await unlinkMyTelegram();
			linkCode = null;
			me = await getMyNotifications();
			toastStore.success('Telegram unlinked');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Unlink failed');
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

	const deepLink = $derived(
		caps?.telegram.botUsername && linkCode
			? `https://t.me/${caps.telegram.botUsername}?start=${linkCode}`
			: null,
	);

	// Each deployment runs its own bot, so the handle has to be shown, not assumed.
	const botHandle = $derived(caps?.telegram.botUsername ? `@${caps.telegram.botUsername}` : null);
	const botLink = $derived(
		caps?.telegram.botUsername ? `https://t.me/${caps.telegram.botUsername}` : null,
	);
	// t.me hands off to the desktop app, which is no use to someone on Telegram Web.
	const botWebLink = $derived(
		caps?.telegram.botUsername ? `https://web.telegram.org/k/#@${caps.telegram.botUsername}` : null,
	);

	// Bridges the usual split of dashboard on a desktop, Telegram on a phone.
	let qrDataUrl = $state<string | null>(null);
	$effect(() => {
		const target = deepLink;
		if (!target) {
			qrDataUrl = null;
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(target, { margin: 1, width: 176 })
			.then((url) => {
				if (!cancelled) qrDataUrl = url;
			})
			.catch(() => {
				if (!cancelled) qrDataUrl = null;
			});
		return () => {
			cancelled = true;
		};
	});

	// The link completes in Telegram, so this tab has to poll to notice.
	$effect(() => {
		if (!linkCode || me?.telegram.status === 'linked') return;
		const timer = setInterval(async () => {
			try {
				const next = await getMyNotifications();
				me = next;
				if (next.telegram.status === 'linked') {
					linkCode = null;
					toastStore.success('Telegram connected');
				}
			} catch {
				// A failed poll is not worth a toast; the next tick retries.
			}
		}, 3000);
		return () => clearInterval(timer);
	});

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

			<!-- Email -->
			<div class="border border-brand-divider rounded-lg p-4 mb-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<div class="font-medium text-brand-text">Email alerts</div>
						<div class="text-sm text-brand-text-muted">
							{#if !caps.email.available}
								Unavailable, the server has no email backend configured (set
								<code>EMAIL_BACKEND</code> and its credentials).
							{:else if me.email}
								Sent to <span class="font-mono">{me.email}</span>
								{#if me.email_verified}
									<Badge variant="ok">verified</Badge>
								{:else}
									<Badge variant="warning">unverified</Badge>
								{/if}
							{:else}
								No email address on your account.
							{/if}
						</div>
					</div>
					<label class="flex items-center gap-2 shrink-0">
						<input
							type="checkbox"
							class="w-4 h-4"
							checked={me.email_enabled}
							disabled={busy || !caps.email.available || !me.email_verified}
							onchange={(e) => toggleEmail(e.currentTarget.checked)}
						/>
						<span class="text-sm">Enabled</span>
					</label>
				</div>
				{#if caps.email.available && me.email && !me.email_verified}
					<p class="text-sm text-severity-warning-text mt-2">
						Verify your email in your account to enable email alerts.
					</p>
				{/if}
			</div>

			<!-- Telegram -->
			<div class="border border-brand-divider rounded-lg p-4 mb-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<div class="font-medium text-brand-text">Telegram alerts</div>
						<div class="text-sm text-brand-text-muted">
							{#if !caps.telegram.available}
								Unavailable, the server has no bot configured (set <code>TELEGRAM_BOT_TOKEN</code>).
							{:else if me.telegram.status === 'linked'}
								<Badge variant="ok">linked</Badge>
								Connected to
								{#if botHandle}
									<a class="text-brand-primary underline" href={botLink} target="_blank" rel="noopener">
										{botHandle}
									</a>.
								{:else}
									the bot.
								{/if}
							{:else if me.telegram.status === 'pending'}
								<Badge variant="warning">pending</Badge>
								Waiting for you to message {botHandle ?? 'the bot'}.
							{:else}
								<Badge variant="muted">not linked</Badge>
								Get alarms and query the data from Telegram
								{#if botHandle}
									via
									<a class="text-brand-primary underline" href={botLink} target="_blank" rel="noopener">
										{botHandle}
									</a>.
								{/if}
							{/if}
						</div>
					</div>
					{#if caps.telegram.available}
						<label class="flex items-center gap-2 shrink-0">
							<input
								type="checkbox"
								class="w-4 h-4"
								checked={me.telegram_enabled}
								disabled={busy}
								onchange={(e) => toggleTelegram(e.currentTarget.checked)}
							/>
							<span class="text-sm">Enabled</span>
						</label>
					{/if}
				</div>

				<!-- Each deployment runs its own bot, so which one this is matters. -->
				{#if caps.telegram.available && botHandle}
					<div class="mt-3 flex items-start gap-3 rounded-md border border-brand-divider p-3">
						<div class="text-sm">
							<div class="font-medium text-brand-text">
								{caps.telegram.botName ?? botHandle}
								{#if caps.telegram.botName}
									<span class="font-normal text-brand-text-muted">{botHandle}</span>
								{/if}
							</div>
							{#if caps.telegram.botDescription}
								<p class="text-brand-text-muted mt-0.5">{caps.telegram.botDescription}</p>
							{/if}
							<a
								class="text-brand-primary underline"
								href={botLink}
								target="_blank"
								rel="noopener">Open in Telegram</a
							>
						</div>
					</div>
				{/if}

				{#if caps.telegram.available && me.telegram.status === 'linked'}
					<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-brand-muted">
						{#if me.telegram.linked_at}
							<dt>Linked</dt>
							<dd>{formatDateTime(me.telegram.linked_at)}</dd>
						{/if}
						{#if me.telegram.last_used_at}
							<dt>Last used</dt>
							<dd>{formatDateTime(me.telegram.last_used_at)}</dd>
						{/if}
						{#if me.telegram.attested_until}
							<dt>Expires</dt>
							<dd>
								{formatDateTime(me.telegram.attested_until)}
								<span class="block text-xs">
									Renewed automatically whenever you sign in here, so there is nothing to do.
								</span>
							</dd>
						{/if}
					</dl>
				{/if}

				{#if caps.telegram.available}
					<div class="mt-3 flex flex-wrap items-center gap-2">
						{#if me.telegram.status === 'linked'}
							<ConfirmPopover message="Unlink your Telegram chat?" onconfirm={unlink}>
								<Button variant="danger" size="sm" disabled={busy}>Unlink</Button>
							</ConfirmPopover>
							<!-- Admin-only: if anyone could opt out, nothing would ever expire. -->
							{#if meStore.can('admin')}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										class="w-4 h-4"
										checked={me.expiry_exempt}
										disabled={busy}
										onchange={(e) => togglePin(e.currentTarget.checked)}
									/>
									<span title="Exempt this link from idle expiry. It still lapses if nobody signs in, and a revoked account is still cut off.">
										Never expire
									</span>
								</label>
							{/if}
						{:else}
							<Button variant="primary" size="sm" disabled={busy} onclick={linkTelegram}>
								{me.telegram.status === 'pending' ? 'Generate a new code' : 'Link Telegram'}
							</Button>
						{/if}
					</div>

					{#if linkCode}
						<div class="mt-3 rounded-md bg-brand-bg p-4 text-sm">
							<div class="flex flex-wrap gap-4">
								<div class="flex-1 min-w-[16rem] space-y-3">
									<div>
										<div class="font-medium text-brand-text mb-1">On this device</div>
										{#if deepLink}
											<a href={deepLink} target="_blank" rel="noopener">
												<Button variant="primary" size="sm">Open Telegram and connect</Button>
											</a>
											{#if botWebLink}
												<p class="text-brand-text-muted mt-1">
													Using Telegram in the browser? Open
													<a
														class="text-brand-primary underline"
														href={botWebLink}
														target="_blank"
														rel="noopener">{botHandle} on Telegram Web</a
													>
													and send the command below.
												</p>
											{/if}
										{:else}
											<p class="text-brand-text-muted">
												This deployment has no bot name configured, so send the code by hand.
											</p>
										{/if}
									</div>

									<div>
										<div class="font-medium text-brand-text mb-1">By hand</div>
										<p class="text-brand-text-muted mb-1">
											{#if botHandle}
												Search Telegram for
												<a class="text-brand-primary underline" href={botLink} target="_blank" rel="noopener">
													{botHandle}
												</a>, start a chat, and send:
											{:else}
												Start a chat with the bot and send:
											{/if}
										</p>
										<div class="flex items-center gap-2">
											<code class="font-mono px-2 py-1 bg-white border border-brand-divider rounded">/start {linkCode}</code>
											<CopyButton text={`/start ${linkCode}`} />
										</div>
									</div>

									{#if me.telegram.code_expires_at}
										<p class="text-brand-text-muted">
											This code expires {formatDateTime(me.telegram.code_expires_at)}. Generate a new
											one if it runs out.
										</p>
									{/if}
									<p class="text-brand-text-muted">Waiting for you to connect…</p>
								</div>

								{#if qrDataUrl}
									<div class="text-center">
										<div class="font-medium text-brand-text mb-1">On your phone</div>
										<img
											src={qrDataUrl}
											alt="QR code that opens the bot and sends your link code"
											class="rounded border border-brand-divider bg-white p-1"
											width="176"
											height="176"
										/>
									</div>
								{/if}
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
