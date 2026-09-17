<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$auth/keycloak.svelte';
	import { me, type Capability } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS } from '$lib/toolbox/authoring';
	import { onMount } from 'svelte';
	import Button from '$components/ui/Button.svelte';
	import ToastContainer from '$components/ui/ToastContainer.svelte';
	import SearchBar from '$components/SearchBar.svelte';
	import SiteNavigator from '$components/SiteNavigator.svelte';
	import NavIcon from '$components/NavIcon.svelte';
	import Unauthorized from '$components/Unauthorized.svelte';
	import Landing from '$components/Landing.svelte';
	import { shellBranch } from '$auth/shell';
	import AlarmIndicator from '$components/AlarmIndicator.svelte';
	import OperationsIndicator from '$components/OperationsIndicator.svelte';
	import {
		getVersion,
		getNotificationsConfig,
		registerPushSubscription,
		getUnpairedSummary,
		listReplicateAudits,
	} from '$api/service';
	import { syncSubscription, isWebPushSupported } from '$lib/push';
	import { timezoneStore } from '$lib/stores/timezone.svelte';

	let { children } = $props();
	let sidebarCollapsed = $state(false);
	let mobileMenuOpen = $state(false);

	// Build versions for the sidebar footer. UI version is baked into the bundle at build time; the
	// API version is fetched once (authenticated) so it reflects the actual running backend.
	const uiVersion = __APP_VERSION__;
	let apiVersion = $state('');
	let versionFetched = false;
	$effect(() => {
		if (!versionFetched && auth.authenticated) {
			versionFetched = true;
			getVersion()
				.then((v) => (apiVersion = `${v.version} (${v.commit})`))
				.catch(() => (apiVersion = 'unknown'));
		}
	});

	let pushSynced = false;
	$effect(() => {
		if (!pushSynced && auth.authenticated && isWebPushSupported()) {
			pushSynced = true;
			getNotificationsConfig()
				.then((cfg) => {
					const key = cfg.webPush?.vapidPublicKey;
					if (key) {
						syncSubscription(key, (payload) => registerPushSubscription(payload).then(() => {}));
					}
				})
				.catch(() => {});
		}
	});

	// Streams arriving unpaired and holds waiting for a decision are only ever found by opening the
	// page they live on, so the count comes to the nav entry that leads there.
	const ATTENTION_POLL_MS = 60_000;
	let streamsAttention = $state(0);
	let attentionPolling = false;

	async function loadStreamsAttention() {
		try {
			const [unpaired, holds] = await Promise.all([
				getUnpairedSummary(),
				listReplicateAudits({ page_size: 1 }),
			]);
			streamsAttention =
				unpaired.reduce((total, row) => total + row.unpaired, 0) + holds.pending + holds.deferred;
		} catch {
			/* a failed count is not worth a message in the nav */
		}
	}

	onMount(() => {
		auth.init();
	});

	$effect(() => {
		if (attentionPolling || !auth.authenticated || !me.can('admin')) return;
		attentionPolling = true;
		void loadStreamsAttention();
		const timer = setInterval(() => void loadStreamsAttention(), ATTENTION_POLL_MS);
		return () => clearInterval(timer);
	});

	// Resolve the caller's level + grants from /api/me once auth is ready; drives capability-gated nav.
	$effect(() => {
		if (auth.authenticated) {
			me.ensure();
		}
	});

	const branch = $derived(shellBranch(auth.state.status, auth.role));

	// A nav item is visible when the caller holds its minimum capability (or it names none).
	// The client's IA: three groups gated by capability. A section renders only when at least one of
	// its items is visible to the caller (see the template filter), so lower levels see a shorter menu.
	// `also` lists sibling routes that should light the item (merged pages and their old redirect URLs).
	// `badge` names the count shown against the item, when one is loaded and non-zero.
	type NavItem = {
		href: string;
		label: string;
		icon: string;
		minCap?: Capability;
		also?: string[];
		badge?: 'streamsAttention';
	};
	const navSections: { label: string; items: NavItem[] }[] = [
		{
			label: 'Data',
			items: [
				{ href: `${base}/explore`, label: 'Explore', icon: 'chart', minCap: 'readData', also: [`${base}/compare`, `${base}/scatter`, `${base}/day-of-year`] },
				{ href: `${base}/events`, label: 'Visits', icon: 'pin', minCap: 'readData' },
				{ href: `${base}/alarms`, label: 'Alarms', icon: 'bell' },
				{ href: `${base}/data-entry`, label: 'Data entry', icon: 'wrench' },
				{ href: `${base}/upload`, label: 'Upload', icon: 'upload', minCap: 'writeData' },
			],
		},
		{
			label: 'Inventory',
			items: [
				{ href: `${base}/sensors`, label: 'Sensors & Instruments', icon: 'cpu', also: [`${base}/instruments`] },
				{ href: `${base}/parameters`, label: 'Parameters', icon: 'sliders', minCap: 'writeCatalog', also: [`${base}/constants`, `${base}/derived`] },
				{ href: `${base}/toolbox`, label: 'Toolbox', icon: 'wrench', minCap: AUTHOR_CALCULATIONS, also: [`${base}/calculations`, `${base}/tools/manage`] },
			],
		},
		{
			label: 'Admin',
			items: [
				{ href: `${base}/projects`, label: 'Projects & Subprojects', icon: 'folder', minCap: 'admin' },
				{ href: `${base}/users`, label: 'Users & Tokens', icon: 'users', minCap: 'admin', also: [`${base}/tokens`] },
				{ href: `${base}/notifications`, label: 'Notifications', icon: 'mail', minCap: 'admin' },
				{ href: `${base}/streams`, label: 'Sync services', icon: 'rss', minCap: 'admin', badge: 'streamsAttention' },
				{ href: `${base}/system`, label: 'System', icon: 'settings', minCap: 'admin', also: [`${base}/logs`, `${base}/jobs`, `${base}/schedules`] },
			],
		},
	];

	function matches(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}

	function isActive(item: NavItem): boolean {
		return matches(item.href) || (item.also?.some(matches) ?? false);
	}
</script>

{#if branch === 'loading'}
	<div class="flex h-screen items-center justify-center flex-col text-brand-muted">
		<p class="text-lg">Loading RIVER Data Admin…</p>
		<p class="text-sm mt-2">Initializing…</p>
	</div>
{:else if branch === 'error' && auth.state.status === 'error'}
	<div class="flex h-screen items-center justify-center flex-col text-center px-5">
		<p class="text-lg text-severity-alarm">Authentication Error</p>
		<p class="text-sm mt-2 text-brand-muted max-w-[400px]">{auth.state.message}</p>
		<Button
			variant="primary"
			onclick={() => window.location.reload()}
			class="mt-5"
		>
			Retry
		</Button>
	</div>
{:else if branch === 'landing'}
	<Landing />
{:else if branch === 'unauthorized'}
	<!-- Authenticated but no riverdata role: the API rejects every call with 403 no_river_role,
	     so take over the whole shell instead of rendering an app that can't load anything. -->
	<Unauthorized />
{:else}
	<div class="flex h-screen overflow-hidden">
		<!-- Mobile sidebar backdrop -->
		{#if mobileMenuOpen}
			<button
				class="fixed inset-0 z-40 bg-black/40 md:hidden"
				onclick={() => (mobileMenuOpen = false)}
				aria-label="Close menu"
			></button>
		{/if}
		<!-- Sidebar -->
		<nav
			class="flex flex-col bg-brand-surface border-r border-brand-divider overflow-y-auto shrink-0 transition-[width,transform] duration-200
				fixed inset-y-0 left-0 z-50 md:relative md:z-auto
				{mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0"
			style:width={sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)'}
		>
			<!-- Logo / title -->
			<div class="flex items-center h-12 px-4 border-b border-brand-divider shrink-0">
				{#if !sidebarCollapsed}
					<a href={base} class="font-semibold text-brand-primary no-underline text-[0.95rem]">
						RIVER Data
					</a>
				{/if}
				<button
					onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
					class="ml-auto p-1 text-brand-muted hover:text-brand-text cursor-pointer bg-transparent border-none"
					title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{sidebarCollapsed ? '▶' : '◀'}
				</button>
			</div>

			<!-- Dashboard link -->
			<a
				href={base}
				title={sidebarCollapsed ? 'Dashboard' : undefined}
				class="flex items-center gap-2 px-4 py-2 text-sm no-underline {sidebarCollapsed ? 'justify-center' : ''} {page.url.pathname === base || page.url.pathname === base + '/'
					? 'text-brand-primary bg-brand-primary/5 font-semibold'
					: 'text-brand-text hover:bg-brand-bg'}"
			>
				<NavIcon name="home" />
				{#if !sidebarCollapsed}Dashboard{/if}
			</a>

			<!-- Site navigator: the caller's sites, quick access. Capped at 40% of viewport height. -->
			<SiteNavigator collapsed={sidebarCollapsed} />

			<!-- Nav sections. A section only appears when the caller can see at least one of its items. -->
			{#each navSections as section}
				{@const visibleItems = section.items.filter((i) => !i.minCap || me.can(i.minCap))}
				{#if visibleItems.length > 0}
					{#if !sidebarCollapsed}
						<div class="px-4 pt-4 pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-muted">
							{section.label}
						</div>
					{:else}
						<div class="h-px bg-brand-divider mx-2 my-2"></div>
					{/if}
					{#each visibleItems as item}
						<a
							href={item.href}
							class="flex items-center gap-2 px-4 py-1.5 text-sm no-underline transition-colors {sidebarCollapsed ? 'justify-center' : ''} {isActive(item)
								? 'text-brand-primary bg-brand-primary/5 font-semibold'
								: 'text-brand-text hover:bg-brand-bg'}"
							title={sidebarCollapsed ? item.label : undefined}
						>
							<NavIcon name={item.icon} />
							{#if !sidebarCollapsed}
								{item.label}
							{/if}
							{#if item.badge === 'streamsAttention' && streamsAttention > 0 && !sidebarCollapsed}
								<span
									class="ml-auto rounded-full bg-severity-warning-fill px-1.5 py-0.5 text-[0.625rem] font-bold leading-none text-white"
									title="{streamsAttention} unpaired stream(s) and open hold(s) awaiting review"
								>
									{streamsAttention}
								</span>
							{/if}
						</a>
					{/each}
				{/if}
			{/each}

			<!-- Build versions -->
			<div class="mt-auto px-4 py-3 border-t border-brand-divider">
				{#if !sidebarCollapsed}
					<div class="text-[0.6875rem] text-brand-muted leading-relaxed font-mono">
						<div title="Dashboard build">UI {uiVersion}</div>
						<div title="API build">API {apiVersion || '…'}</div>
					</div>
				{/if}
			</div>
		</nav>

		<!-- Main content -->
		<div class="flex flex-col flex-1 overflow-hidden">
			<!-- Top bar -->
			<header class="flex items-center h-12 px-4 bg-brand-primary text-white shrink-0 gap-3">
				<button
					class="md:hidden p-1 text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
					aria-label="Toggle menu"
				>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
						<rect y="3" width="20" height="2" rx="1" />
						<rect y="9" width="20" height="2" rx="1" />
						<rect y="15" width="20" height="2" rx="1" />
					</svg>
				</button>
				<h1 class="text-[0.95rem] font-semibold">RIVER Data: Admin</h1>
				<div class="flex-1"></div>
				<SearchBar />
				<OperationsIndicator />
				<AlarmIndicator />
				<button
					onclick={() => timezoneStore.toggle()}
					class="text-xs font-mono px-2 py-1 rounded border border-white/25 text-white/80 hover:text-white hover:border-white/50 bg-transparent cursor-pointer"
					title={timezoneStore.mode === 'utc'
						? 'Times shown in UTC, click to switch to your local time'
						: 'Times shown in your local time, click to switch to UTC'}
				>
					{timezoneStore.mode === 'utc' ? 'UTC' : 'Local'}
				</button>
				{#if auth.identity}
					<a
						href={`${base}/settings`}
						class="text-sm opacity-80 hover:opacity-100 hover:underline"
						title="Account settings"
					>
						{auth.identity.fullName}
					</a>
				{/if}
				{#if auth.state.status === 'authenticated'}
					<button
						onclick={() => auth.logout()}
						class="text-sm text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
					>
						Logout
					</button>
				{/if}
			</header>

			<!-- Page content -->
			<main class="flex-1 overflow-y-auto p-[var(--spacing-page-gutter)]">
				{@render children()}
			</main>
		</div>
	</div>
	<ToastContainer />
{/if}
