/**
 * Installation state manager for tracking progress and enabling resume.
 *
 * This allows the tool to recover from failures and resume installations
 * from the last successful step.
 */

export interface InstallationStep {
	id: string;
	description: string;
	status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
	timestamp?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface InstallationState {
	version: string;
	startedAt: string;
	updatedAt: string;
	mode: 'legacy' | 'easy' | 'hard' | 'standard' | 'advanced'; // Support both naming conventions
	nodeType: 'full' | 'validator' | 'archiver';
	currentStep: number;
	totalSteps: number;
	steps: InstallationStep[];
	configuration: {
		nodeName?: string;
		basePath?: string;
		serviceUser?: string;
		keystorePath?: string;
	};
	metadata: Record<string, unknown>;
}

const STATE_FILE_PATH = '/var/lib/d9-manager/.installation-state.json';
const STATE_BACKUP_PATH = '/var/lib/d9-manager/.installation-state.backup.json';

/**
 * Manages installation state persistence
 */
export class InstallationStateManager {
	private state: InstallationState | null = null;

	constructor(private readonly statePath: string = STATE_FILE_PATH) {}

	/**
	 * Initialize a new installation state
	 */
	async initializeState(
		mode: InstallationState['mode'],
		nodeType: InstallationState['nodeType'],
		steps: Omit<InstallationStep, 'status' | 'timestamp'>[]
	): Promise<void> {
		const now = new Date().toISOString();

		this.state = {
			version: '1.0',
			startedAt: now,
			updatedAt: now,
			mode,
			nodeType,
			currentStep: 0,
			totalSteps: steps.length,
			steps: steps.map((step) => ({
				...step,
				status: 'pending' as const,
			})),
			configuration: {},
			metadata: {},
		};

		await this.saveState();
	}

	/**
	 * Load existing state from disk
	 */
	async loadState(): Promise<InstallationState | null> {
		try {
			const content = await Deno.readTextFile(this.statePath);
			this.state = JSON.parse(content);
			return this.state;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return null;
			}
			throw new Error(`Failed to load state: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Save current state to disk
	 */
	async saveState(): Promise<void> {
		if (!this.state) {
			throw new Error('No state to save');
		}

		this.state.updatedAt = new Date().toISOString();

		try {
			// Ensure directory exists
			await Deno.mkdir('/var/lib/d9-manager', { recursive: true });

			// Backup existing state
			try {
				await Deno.copyFile(this.statePath, STATE_BACKUP_PATH);
			} catch {
				// Ignore if source doesn't exist
			}

			// Write new state
			await Deno.writeTextFile(this.statePath, JSON.stringify(this.state, null, 2));
		} catch (error) {
			throw new Error(`Failed to save state: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Mark a step as in progress
	 */
	async startStep(stepId: string): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		const step = this.state.steps.find((s) => s.id === stepId);
		if (!step) {
			throw new Error(`Step not found: ${stepId}`);
		}

		step.status = 'in_progress';
		step.timestamp = new Date().toISOString();
		this.state.currentStep = this.state.steps.indexOf(step);

		await this.saveState();
	}

	/**
	 * Mark a step as completed
	 */
	async completeStep(stepId: string, metadata?: Record<string, unknown>): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		const step = this.state.steps.find((s) => s.id === stepId);
		if (!step) {
			throw new Error(`Step not found: ${stepId}`);
		}

		step.status = 'completed';
		step.timestamp = new Date().toISOString();
		if (metadata) {
			step.metadata = { ...step.metadata, ...metadata };
		}

		await this.saveState();
	}

	/**
	 * Mark a step as failed
	 */
	async failStep(stepId: string, error: string): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		const step = this.state.steps.find((s) => s.id === stepId);
		if (!step) {
			throw new Error(`Step not found: ${stepId}`);
		}

		step.status = 'failed';
		step.error = error;
		step.timestamp = new Date().toISOString();

		await this.saveState();
	}

	/**
	 * Skip a step (already done, not applicable)
	 */
	async skipStep(stepId: string, reason?: string): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		const step = this.state.steps.find((s) => s.id === stepId);
		if (!step) {
			throw new Error(`Step not found: ${stepId}`);
		}

		step.status = 'skipped';
		step.timestamp = new Date().toISOString();
		if (reason) {
			step.metadata = { ...step.metadata, skipReason: reason };
		}

		await this.saveState();
	}

	/**
	 * Update configuration values
	 */
	async updateConfiguration(config: Partial<InstallationState['configuration']>): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		this.state.configuration = { ...this.state.configuration, ...config };
		await this.saveState();
	}

	/**
	 * Update metadata
	 */
	async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
		if (!this.state) {
			throw new Error('State not initialized');
		}

		this.state.metadata = { ...this.state.metadata, ...metadata };
		await this.saveState();
	}

	/**
	 * Get current state
	 */
	getState(): InstallationState | null {
		return this.state;
	}

	/**
	 * Get steps that need to be executed (pending or failed)
	 */
	getPendingSteps(): InstallationStep[] {
		if (!this.state) {
			return [];
		}

		return this.state.steps.filter((step) => step.status === 'pending' || step.status === 'failed');
	}

	/**
	 * Get completed steps
	 */
	getCompletedSteps(): InstallationStep[] {
		if (!this.state) {
			return [];
		}

		return this.state.steps.filter((step) => step.status === 'completed');
	}

	/**
	 * Get progress percentage
	 */
	getProgress(): number {
		if (!this.state || this.state.totalSteps === 0) {
			return 0;
		}

		const completed = this.getCompletedSteps().length;
		return Math.round((completed / this.state.totalSteps) * 100);
	}

	/**
	 * Check if installation can be resumed
	 */
	canResume(): boolean {
		if (!this.state) {
			return false;
		}

		const hasCompletedSteps = this.getCompletedSteps().length > 0;
		const hasPendingSteps = this.getPendingSteps().length > 0;

		return hasCompletedSteps && hasPendingSteps;
	}

	/**
	 * Clear state (after successful completion or manual cleanup)
	 */
	async clearState(): Promise<void> {
		try {
			await Deno.remove(this.statePath);
			await Deno.remove(STATE_BACKUP_PATH);
		} catch {
			// Ignore if files don't exist
		}

		this.state = null;
	}

	/**
	 * Display progress summary
	 */
	displayProgress(): void {
		if (!this.state) {
			console.log('No installation in progress');
			return;
		}

		console.log('\n📊 Installation Progress');
		console.log('═'.repeat(50));
		console.log(`Mode: ${this.state.mode}`);
		console.log(`Node Type: ${this.state.nodeType}`);
		console.log(`Started: ${new Date(this.state.startedAt).toLocaleString()}`);
		console.log(`Progress: ${this.getProgress()}% (${this.getCompletedSteps().length}/${this.state.totalSteps} steps)`);
		console.log('\nSteps:');

		for (const step of this.state.steps) {
			const icon =
				step.status === 'completed'
					? '✅'
					: step.status === 'in_progress'
						? '⏳'
						: step.status === 'failed'
							? '❌'
							: step.status === 'skipped'
								? '⏭️'
								: '⏸️';

			console.log(`  ${icon} ${step.description}`);
			if (step.error) {
				console.log(`     Error: ${step.error}`);
			}
		}

		console.log('═'.repeat(50));
	}
}
