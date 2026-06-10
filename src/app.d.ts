declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Build-time constant injected by Vite (`define`). UI version: git tag on prod, short SHA on dev.
	const __APP_VERSION__: string;
}

export {};
