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
import { Messages } from '../types.ts';

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

  constructor(
    private readonly messages: Messages,
    stateFilePath?: string
  ) {
    this.stateManager = new InstallationStateManager(messages, stateFilePath);
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
      throw new Error(this.messages.transaction.notInitialized);
    }

    const pendingSteps = this.stateManager.getPendingSteps();
    const executedOps: Array<{ step: InstallationStep; operation: Operation }> = [];

    console.log(this.messages.transaction.startingExecution);
    console.log(this.messages.transaction.pendingSteps.replace('%s', pendingSteps.length.toString()).replace('%s', state.totalSteps.toString()));

    try {
      for (const step of pendingSteps) {
        const operation = this.operations.get(step.id);
        if (!operation) {
          throw new Error(this.messages.transaction.operationNotFound.replace('%s', step.id));
        }

        console.log(this.messages.transaction.executing.replace('%s', step.description));

        // Mark step as in progress
        await this.stateManager.startStep(step.id);

        // Check if already done (idempotency)
        if (await operation.isAlreadyDone()) {
          console.log(this.messages.transaction.alreadyDone);
          await this.stateManager.skipStep(step.id, 'Already completed');
          continue;
        }

        // Validate operation
        const validation = await operation.validate();
        if (!validation.success || !validation.value) {
          const errorMsg = validation.error || 'Prerequisites not met';
          console.error(this.messages.transaction.validationFailed.replace('%s', errorMsg));
          await this.stateManager.failStep(step.id, errorMsg);
          throw new Error(`${step.description} validation failed: ${errorMsg}`);
        }

        // Execute operation
        const result = await operation.execute();
        if (!result.success) {
          const errorMsg = result.error || 'Operation failed';
          console.error(this.messages.transaction.failed.replace('%s', errorMsg));
          await this.stateManager.failStep(step.id, errorMsg);
          throw new Error(`${step.description} failed: ${errorMsg}`);
        }

        // Mark as completed
        await this.stateManager.completeStep(step.id, result.context);
        executedOps.push({ step, operation });
        console.log(this.messages.transaction.completed);
      }

      console.log(this.messages.transaction.completedSuccessfully);
      this.stateManager.displayProgress();

      return {
        success: true,
        completedSteps: state.totalSteps,
        totalSteps: state.totalSteps,
        canResume: false,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(this.messages.transaction.transactionFailed.replace('%s', errorMessage));
      console.log(this.messages.transaction.rollingBack);

      // Rollback in reverse order
      for (const { step, operation } of executedOps.reverse()) {
        try {
          console.log(`  🔄 ${step.description}`);
          await operation.rollback();
          console.log(this.messages.transaction.rolledBack.replace('%s', step.description));
        } catch (rollbackError) {
          console.error(
            this.messages.transaction.rollbackFailed
              .replace('%s', step.description)
              .replace('%s', rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
          );
        }
      }

      console.log(this.messages.transaction.stateSaved);
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
      throw new Error(this.messages.transaction.noExistingTransaction);
    }

    if (!this.stateManager.canResume()) {
      throw new Error(this.messages.transaction.cannotResume);
    }

    console.log(this.messages.transaction.resuming);
    this.stateManager.displayProgress();

    return await this.execute();
  }

  /**
   * Clear transaction state after successful completion
   */
  async clear(): Promise<void> {
    await this.stateManager.clearState();
    this.operations.clear();
    console.log(this.messages.transaction.stateCleared);
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
  messages: Messages,
  operations: Operation[],
  options: TransactionOptions
): Promise<TransactionManager> {
  const txManager = new TransactionManager(messages);
  await txManager.initialize(operations, options);
  return txManager;
}

/**
 * Helper to resume an existing transaction
 */
export async function resumeTransaction(messages: Messages): Promise<TransactionManager | null> {
  const txManager = new TransactionManager(messages);
  const hasState = await txManager.loadExisting();

  if (!hasState) {
    return null;
  }

  return txManager;
}
