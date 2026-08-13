<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$auth/keycloak.svelte';
	import { me, type Capability } from '$auth/me.svelte';
	import { onMount } from 'svelte';
	import Button from '$components/ui/Button.svelte';
	import ToastContainer from '$components/ui/ToastContainer.svelte';
	import SearchBar from '$components/SearchBar.svelte';
	import SiteNavigator from '$components/SiteNavigator.svelte';
	import NavIcon from '$components/NavIcon.svelte';
	import Unauthorized from '$components/Unauthorized.svelte';
	import AlarmIndicator from '$components/AlarmIndicator.svelte';
	import OperationsIndicator from '$components/OperationsIndicator.svelte';
	import { getVersion } from '$api/service';
	import { timezoneStore } from '$lib/stores/timezone.svelte';

	let { children } = $props();
	let sidebarCollapsed = $state(false);

	// Build versions for the sidebar footer. UI version is baked into the bundle at build time; the
	// API version is fetched once (authenticated) so it reflects the actual running backend.
	const uiVersion = __APP_VERSION__;
	let apiVersion = $state('');
	let versionFetched = false;
	$effect(() => {
		const status = auth.state.status;
		if (!versionFetched && status !== 'loading' && status !== 'error') {
			versionFetched = true;
			getVersion()
				.then((v) => (apiVersion = `${v.version} (${v.commit})`))
				.catch(() => (apiVersion = 'unknown'));
		}
	});

	onMount(() => {
		auth.init();
	});

	// Resolve the caller's level + grants from /api/me once auth is ready; drives capability-gated nav.
	$effect(() => {
		if (auth.state.status !== 'loading' && auth.state.status !== 'error') {
			me.ensure();
		}
	});

	// A nav item is visible when the caller holds its minimum capability (or it names none).
	// The client's IA: three groups gated by capability. A section renders only when at least one of
	// its items is visible to the caller (see the template filter), so lower levels see a shorter menu.
	// `also` lists sibling routes that should light the item (merged pages and their old redirect URLs).
	type NavItem = { href: string; label: string; icon: string; minCap?: Capability; also?: string[] };
	const navSections: { label: string; items: NavItem[] }[] = [
		{
			label: 'Data',
			items: [
				{ href: `${base}/explore`, label: 'Explore', icon: 'chart', minCap: 'readData', also: [`${base}/compare`, `${base}/scatter`, `${base}/day-of-year`] },
				{ href: `${base}/alarms`, label: 'Alarms', icon: 'bell' },
				{ href: `${base}/tools`, label: 'Tools', icon: 'wrench' },
				{ href: `${base}/upload`, label: 'Upload', icon: 'upload', minCap: 'writeData' },
			],
		},
		{
			label: 'Inventory',
			items: [
				{ href: `${base}/sensors`, label: 'Sensors & Instruments', icon: 'cpu', also: [`${base}/instruments`, `${base}/sensor-calibrations`, `${base}/sensor-deployments`] },
				{ href: `${base}/parameters`, label: 'Parameters', icon: 'sliders', minCap: 'writeCatalog', also: [`${base}/constants`, `${base}/derived`] },
			],
		},
		{
			label: 'Admin',
			items: [
				{ href: `${base}/projects`, label: 'Projects & Subprojects', icon: 'folder', minCap: 'admin' },
				{ href: `${base}/users`, label: 'Users & Tokens', icon: 'users', minCap: 'admin', also: [`${base}/tokens`] },
				{ href: `${base}/notifications`, label: 'Notifications', icon: 'mail', minCap: 'admin' },
				{ href: `${base}/streams`, label: 'Data Streams', icon: 'rss', minCap: 'admin' },
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

{#if auth.state.status === 'loading'}
	<div class="flex h-screen items-center justify-center flex-col text-brand-muted">
		<p class="text-lg">Loading River Data Admin…</p>
		<p class="text-sm mt-2">Initializing…</p>
	</div>
{:else if auth.state.status === 'error'}
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
{:else if auth.role === false}
	<!-- Authenticated but no riverdata role: the API rejects every call with 403 no_river_role,
	     so take over the whole shell instead of rendering an app that can't load anything. -->
	<Unauthorized />
{:else}
	<div class="flex h-screen overflow-hidden">
		<!-- Sidebar -->
		<nav
			class="flex flex-col bg-brand-surface border-r border-brand-divider overflow-y-auto shrink-0 transition-[width] duration-200"
			style:width={sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)'}
		>
			<!-- Logo / title -->
			<div class="flex items-center h-12 px-4 border-b border-brand-divider shrink-0">
				{#if !sidebarCollapsed}
					<a href={base} class="font-semibold text-brand-primary no-underline text-[0.95rem]">
						River Data
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
				<h1 class="text-[0.95rem] font-semibold">River Data: Admin</h1>
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
