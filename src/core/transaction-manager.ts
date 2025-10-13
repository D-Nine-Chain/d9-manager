/**
 * TransactionManager coordinates operations with automatic rollback on failure.
 *
 * Integrates Operation abstraction with InstallationStateManager to provide:
 * - Transactional execution with rollback
 * - State persistence for resume capability
 * - Progress tracking and reporting
 * - Audit trail of all operations
 */

import { Operation, OperationResult } from './operations.ts';
import { InstallationStateManager, InstallationStep } from './state-manager.ts';

export interface TransactionOptions {
  mode: 'legacy' | 'standard' | 'advanced' | 'easy' | 'hard'; // Support both naming conventions
  nodeType: 'full' | 'validator' | 'archiver';
  configuration?: {
    nodeName?: string;
    basePath?: string;
    serviceUser?: string;
    keystorePath?: string;
  };
}

export interface TransactionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  error?: string;
  canResume: boolean;
}

/**
 * Manages transactional execution of operations with state persistence
 */
export class TransactionManager {
  private stateManager: InstallationStateManager;
  private operations: Map<string, Operation> = new Map();

  constructor(stateFilePath?: string) {
    this.stateManager = new InstallationStateManager(stateFilePath);
  }

  /**
   * Initialize a new transaction
   */
  async initialize(
    operations: Operation[],
    options: TransactionOptions
  ): Promise<void> {
    // Convert operations to installation steps
    const steps = operations.map((op) => ({
      id: `${op.type}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      description: op.description,
    }));

    // Store operation references
    operations.forEach((op, idx) => {
      this.operations.set(steps[idx].id, op);
    });

    // Initialize state
    await this.stateManager.initializeState(
      options.mode,
      options.nodeType,
      steps
    );

    // Store configuration if provided
    if (options.configuration) {
      await this.stateManager.updateConfiguration(options.configuration);
    }
  }

  /**
   * Load existing transaction state for resume
   */
  async loadExisting(): Promise<boolean> {
    const state = await this.stateManager.loadState();
    return state !== null;
  }

  /**
   * Execute all pending operations in the transaction
   */
  async execute(): Promise<TransactionResult> {
    const state = this.stateManager.getState();
    if (!state) {
      throw new Error('Transaction not initialized. Call initialize() or loadExisting() first.');
    }

    const pendingSteps = this.stateManager.getPendingSteps();
    const executedOps: Array<{ step: InstallationStep; operation: Operation }> = [];

    console.log('\n🚀 Starting transaction execution');
    console.log(`📊 ${pendingSteps.length} pending steps out of ${state.totalSteps} total`);

    try {
      for (const step of pendingSteps) {
        const operation = this.operations.get(step.id);
        if (!operation) {
          throw new Error(`Operation not found for step: ${step.id}`);
        }

        console.log(`\n⏳ ${step.description}...`);

        // Mark step as in progress
        await this.stateManager.startStep(step.id);

        // Check if already done (idempotency)
        if (await operation.isAlreadyDone()) {
          console.log(`⏭️  Already done, skipping`);
          await this.stateManager.skipStep(step.id, 'Already completed');
          continue;
        }

        // Validate operation
        const validation = await operation.validate();
        if (!validation.success || !validation.value) {
          const errorMsg = validation.error || 'Prerequisites not met';
          console.error(`❌ Validation failed: ${errorMsg}`);
          await this.stateManager.failStep(step.id, errorMsg);
          throw new Error(`${step.description} validation failed: ${errorMsg}`);
        }

        // Execute operation
        const result = await operation.execute();
        if (!result.success) {
          const errorMsg = result.error || 'Operation failed';
          console.error(`❌ Failed: ${errorMsg}`);
          await this.stateManager.failStep(step.id, errorMsg);
          throw new Error(`${step.description} failed: ${errorMsg}`);
        }

        // Mark as completed
        await this.stateManager.completeStep(step.id, result.context);
        executedOps.push({ step, operation });
        console.log(`✅ Completed`);
      }

      console.log('\n🎉 Transaction completed successfully!');
      this.stateManager.displayProgress();

      return {
        success: true,
        completedSteps: state.totalSteps,
        totalSteps: state.totalSteps,
        canResume: false,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Transaction failed: ${errorMessage}`);
      console.log('🔄 Rolling back completed operations...');

      // Rollback in reverse order
      for (const { step, operation } of executedOps.reverse()) {
        try {
          console.log(`  🔄 Rolling back: ${step.description}`);
          await operation.rollback();
          console.log(`  ✅ Rolled back: ${step.description}`);
        } catch (rollbackError) {
          console.error(
            `  ⚠️  Failed to rollback ${step.description}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      }

      console.log('\n💾 Transaction state saved - you can resume later');
      this.stateManager.displayProgress();

      return {
        success: false,
        completedSteps: this.stateManager.getCompletedSteps().length,
        totalSteps: state.totalSteps,
        error: errorMessage,
        canResume: this.stateManager.canResume(),
      };
    }
  }

  /**
   * Resume a previously failed transaction
   */
  async resume(): Promise<TransactionResult> {
    const state = await this.stateManager.loadState();
    if (!state) {
      throw new Error('No existing transaction to resume');
    }

    if (!this.stateManager.canResume()) {
      throw new Error('Transaction cannot be resumed (either completed or no progress made)');
    }

    console.log('\n🔄 Resuming transaction from last checkpoint');
    this.stateManager.displayProgress();

    return await this.execute();
  }

  /**
   * Clear transaction state after successful completion
   */
  async clear(): Promise<void> {
    await this.stateManager.clearState();
    this.operations.clear();
    console.log('🧹 Transaction state cleared');
  }

  /**
   * Get current progress
   */
  getProgress(): number {
    return this.stateManager.getProgress();
  }

  /**
   * Display current progress
   */
  displayProgress(): void {
    this.stateManager.displayProgress();
  }

  /**
   * Get the state manager (for direct access if needed)
   */
  getStateManager(): InstallationStateManager {
    return this.stateManager;
  }

  /**
   * Add operation after initialization (for dynamic operations)
   */
  addOperation(stepId: string, operation: Operation): void {
    this.operations.set(stepId, operation);
  }
}

/**
 * Helper to create a transaction with common setup
 */
export async function createTransaction(
  operations: Operation[],
  options: TransactionOptions
): Promise<TransactionManager> {
  const txManager = new TransactionManager();
  await txManager.initialize(operations, options);
  return txManager;
}

/**
 * Helper to resume an existing transaction
 */
export async function resumeTransaction(): Promise<TransactionManager | null> {
  const txManager = new TransactionManager();
  const hasState = await txManager.loadExisting();

  if (!hasState) {
    return null;
  }

  return txManager;
}
