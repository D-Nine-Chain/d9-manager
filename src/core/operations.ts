/**
 * Operation abstraction for reversible system modifications.
 *
 * This provides a foundation for transactional operations where any failure
 * can be rolled back to restore the previous state.
 */

/**
 * Result of an operation execution
 */
export interface OperationResult<T = void> {
	success: boolean;
	value?: T;
	error?: string;
	context?: Record<string, unknown>;
}

/**
 * Base interface for reversible operations
 */
export interface Operation<T = void> {
	/** Human-readable description of what this operation does */
	readonly description: string;

	/** Unique identifier for this operation type */
	readonly type: string;

	/**
	 * Execute the operation, making system modifications
	 * @returns Result indicating success/failure and any value produced
	 */
	execute(): Promise<OperationResult<T>>;

	/**
	 * Reverse the operation, restoring previous state
	 * @returns Result indicating success/failure of rollback
	 */
	rollback(): Promise<OperationResult<void>>;

	/**
	 * Check if the operation can be executed in the current system state
	 * @returns Result indicating whether prerequisites are met
	 */
	validate(): Promise<OperationResult<boolean>>;

	/**
	 * Check if this operation needs to be executed (idempotency check)
	 * @returns true if the operation would have no effect (already done)
	 */
	isAlreadyDone(): Promise<boolean>;
}

/**
 * Base class for operations providing common functionality
 */
export abstract class BaseOperation<T = void> implements Operation<T> {
	abstract readonly description: string;
	abstract readonly type: string;

	protected executionState: {
		executed: boolean;
		previousState?: unknown;
	} = { executed: false };

	abstract execute(): Promise<OperationResult<T>>;
	abstract rollback(): Promise<OperationResult<void>>;

	async validate(): Promise<OperationResult<boolean>> {
		return { success: true, value: true };
	}

	async isAlreadyDone(): Promise<boolean> {
		return false;
	}

	/**
	 * Helper to create success result
	 */
	protected successResult<V>(value?: V, context?: Record<string, unknown>): OperationResult<V> {
		return { success: true, value, context };
	}

	/**
	 * Helper to create error result
	 */
	protected errorResult(error: string, context?: Record<string, unknown>): OperationResult<never> {
		return { success: false, error, context };
	}
}

/**
 * Composite operation that executes multiple operations in sequence
 */
export class CompositeOperation extends BaseOperation<void> {
	readonly type = 'composite';

	constructor(
		public readonly description: string,
		private readonly operations: Operation[]
	) {
		super();
	}

	async execute(): Promise<OperationResult<void>> {
		const executedOps: Operation[] = [];

		try {
			for (const op of this.operations) {
				// Check if already done (idempotency)
				if (await op.isAlreadyDone()) {
					console.log(`⏭️  Skipping ${op.description} (already done)`);
					continue;
				}

				// Validate before executing
				const validation = await op.validate();
				if (!validation.success || !validation.value) {
					throw new Error(
						`Validation failed for ${op.description}: ${validation.error || 'Prerequisites not met'}`
					);
				}

				// Execute operation
				const result = await op.execute();
				if (!result.success) {
					throw new Error(`${op.description} failed: ${result.error}`);
				}

				executedOps.push(op);
				this.executionState.executed = true;
			}

			return this.successResult();
		} catch (error) {
			// Rollback all executed operations in reverse order
			console.error(`\n❌ Operation failed: ${error instanceof Error ? error.message : String(error)}`);
			console.log('🔄 Rolling back changes...');

			for (const op of executedOps.reverse()) {
				try {
					await op.rollback();
					console.log(`✅ Rolled back: ${op.description}`);
				} catch (rollbackError) {
					console.error(
						`⚠️  Failed to rollback ${op.description}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
					);
				}
			}

			return this.errorResult(error instanceof Error ? error.message : String(error));
		}
	}

	async rollback(): Promise<OperationResult<void>> {
		// Rollback individual operations in reverse order
		for (const op of this.operations.reverse()) {
			await op.rollback();
		}
		return this.successResult();
	}
}

/**
 * No-op operation for testing or placeholders
 */
export class NoOpOperation extends BaseOperation<void> {
	readonly type = 'noop';
	readonly description: string;

	constructor(description: string = 'No operation') {
		super();
		this.description = description;
	}

	async execute(): Promise<OperationResult<void>> {
		return this.successResult();
	}

	async rollback(): Promise<OperationResult<void>> {
		return this.successResult();
	}

	override async isAlreadyDone(): Promise<boolean> {
		return true;
	}
}
