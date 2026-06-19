<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$auth/keycloak.svelte';
	import { onMount } from 'svelte';
	import Button from '$components/ui/Button.svelte';
	import ToastContainer from '$components/ui/ToastContainer.svelte';
	import SearchBar from '$components/SearchBar.svelte';
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

	// `riverdata-admin` (normalised to 'admin' in keycloak.svelte.ts); local no-auth mode is admin.
	const isAdmin = $derived(auth.role === 'admin');

	onMount(() => {
		auth.init();
	});

	type NavItem = { href: string; label: string; icon: string; adminOnly?: boolean };
	const navSections: { label: string; items: NavItem[] }[] = [
		{
			label: 'Monitor',
			items: [
				{ href: `${base}/sites`, label: 'Sites', icon: 'pin' },
				{ href: `${base}/sensors`, label: 'Sensors', icon: 'cpu' },
				{ href: `${base}/streams`, label: 'Streams', icon: 'rss' },
				{ href: `${base}/alarms`, label: 'Alarms', icon: 'bell' },
				{ href: `${base}/logs`, label: 'Logs', icon: 'clock' },
			],
		},
		{
			label: 'Field Work',
			items: [
				{ href: `${base}/grab-samples`, label: 'Grab Samples', icon: 'flask' },
				{ href: `${base}/upload`, label: 'Upload', icon: 'upload' },
			],
		},
		{
			label: 'Analyze',
			items: [
				{ href: `${base}/compare`, label: 'Compare Sites', icon: 'arrows-lr' },
				{ href: `${base}/tools`, label: 'Tools', icon: 'wrench' },
			],
		},
		{
			label: 'Library',
			items: [
				{ href: `${base}/parameters`, label: 'Parameters', icon: 'sliders' },
				{ href: `${base}/standard-curves`, label: 'Standard Curves', icon: 'chart' },
				{ href: `${base}/constants`, label: 'Constants', icon: 'hash' },
				{ href: `${base}/projects`, label: 'Projects', icon: 'folder' },
			],
		},
		{
			label: 'Admin',
			items: [
				{ href: `${base}/users`, label: 'Users', icon: 'users', adminOnly: true },
				{ href: `${base}/tokens`, label: 'API Tokens', icon: 'settings', adminOnly: true },
				{ href: `${base}/notifications`, label: 'Notifications', icon: 'settings', adminOnly: true },
				{ href: `${base}/system`, label: 'System', icon: 'settings' },
			],
		},
	];

	function isActive(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
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
				class="flex items-center gap-2 px-4 py-2 text-sm no-underline {page.url.pathname === base || page.url.pathname === base + '/'
					? 'text-brand-primary bg-brand-primary/5 font-semibold'
					: 'text-brand-text hover:bg-brand-bg'}"
			>
				{#if !sidebarCollapsed}Dashboard{/if}
			</a>

			<!-- Nav sections -->
			{#each navSections as section}
				{#if !sidebarCollapsed}
					<div class="px-4 pt-4 pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-muted">
						{section.label}
					</div>
				{:else}
					<div class="h-px bg-brand-divider mx-2 my-2"></div>
				{/if}
				{#each section.items.filter((i) => !i.adminOnly || isAdmin) as item}
					<a
						href={item.href}
						class="flex items-center gap-2 px-4 py-1.5 text-sm no-underline transition-colors {isActive(item.href)
							? 'text-brand-primary bg-brand-primary/5 font-semibold'
							: 'text-brand-text hover:bg-brand-bg'}"
						title={sidebarCollapsed ? item.label : undefined}
					>
						{#if !sidebarCollapsed}
							{item.label}
						{/if}
					</a>
				{/each}
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
						? 'Times shown in UTC — click to switch to your local time'
						: 'Times shown in your local time — click to switch to UTC'}
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
