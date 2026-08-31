function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export function isWebPushSupported(): boolean {
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isStandalonePWA(): boolean {
	return window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true;
}

export function isIOSSafari(): boolean {
	const ua = navigator.userAgent;
	return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

export async function getSubscription(): Promise<PushSubscription | null> {
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.getSubscription();
}

export async function subscribe(vapidPublicKey: string): Promise<PushSubscription> {
	const reg = await navigator.serviceWorker.ready;
	return reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
	});
}

export async function unsubscribe(): Promise<void> {
	const sub = await getSubscription();
	if (sub) await sub.unsubscribe();
}

/// Display a notification straight from the service worker, with no push service involved.
/// Separates "the device refuses to show notifications" from "the push never arrived".
export async function showLocalTestNotification(): Promise<void> {
	const reg = await navigator.serviceWorker.ready;
	await reg.showNotification('RIVER Data', {
		body: 'Local test. This device can display notifications.',
		tag: 'river-data-local-test',
	});
}

function toUrlSafeBase64(buffer: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buffer)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export function subscriptionToPayload(sub: PushSubscription) {
	const key = sub.getKey('p256dh');
	const auth = sub.getKey('auth');
	return {
		endpoint: sub.endpoint,
		p256dh: key ? toUrlSafeBase64(key) : '',
		auth: auth ? toUrlSafeBase64(auth) : '',
		user_agent: navigator.userAgent,
	};
}

export async function syncSubscription(
	vapidPublicKey: string,
	registerFn: (payload: { endpoint: string; p256dh: string; auth: string; user_agent: string }) => Promise<void>,
): Promise<void> {
	if (!isWebPushSupported()) return;
	try {
		const reg = await navigator.serviceWorker.ready;
		let sub = await reg.pushManager.getSubscription();
		if (!sub) return;

		const currentKey = sub.options?.applicationServerKey;
		const expectedKey = urlBase64ToUint8Array(vapidPublicKey);
		if (currentKey && !keysMatch(new Uint8Array(currentKey), expectedKey)) {
			await sub.unsubscribe();
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: expectedKey,
			});
		}

		await registerFn(subscriptionToPayload(sub));
	} catch {
		// Service worker or push manager unavailable in this context
	}
}

function keysMatch(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
