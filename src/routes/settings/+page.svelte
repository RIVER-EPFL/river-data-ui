<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$auth/keycloak.svelte';
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

	// Telegram link code (only held in memory right after minting — never returned by GET).
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
</script>

<div class="max-w-3xl mx-auto">
	<h1 class="text-xl font-semibold text-brand-text mb-1">Settings</h1>
	<p class="text-sm text-brand-text-muted mb-6">Manage how you receive alerts from River Data.</p>

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
								Unavailable — the server has no email backend configured (set
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
								Unavailable — the server has no bot configured (set <code>TELEGRAM_BOT_TOKEN</code>).
							{:else if me.telegram.status === 'linked'}
								<Badge variant="ok">linked</Badge> Your Telegram chat is connected.
							{:else if me.telegram.status === 'pending'}
								<Badge variant="warning">pending</Badge> Waiting for you to message the bot.
							{:else}
								<Badge variant="muted">not linked</Badge>
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

				{#if caps.telegram.available}
					<div class="mt-3 flex flex-wrap items-center gap-2">
						{#if me.telegram.status === 'linked'}
							<ConfirmPopover message="Unlink your Telegram chat?" onconfirm={unlink}>
								<Button variant="danger" size="sm" disabled={busy}>Unlink</Button>
							</ConfirmPopover>
						{:else}
							<Button variant="primary" size="sm" disabled={busy} onclick={linkTelegram}>
								{me.telegram.status === 'pending' ? 'Generate a new code' : 'Link Telegram'}
							</Button>
						{/if}
					</div>

					{#if linkCode}
						<div class="mt-3 rounded-md bg-brand-bg p-3 text-sm">
							{#if deepLink}
								<p class="mb-1">
									Open <a class="text-brand-primary underline" href={deepLink} target="_blank" rel="noopener">this link</a>
									to connect, or send the bot:
								</p>
							{:else}
								<p class="mb-1">Send the bot this message to connect:</p>
							{/if}
							<div class="flex items-center gap-2">
								<code class="font-mono px-2 py-1 bg-white border border-brand-divider rounded">/start {linkCode}</code>
								<CopyButton text={`/start ${linkCode}`} />
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
