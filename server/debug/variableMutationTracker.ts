/**
 * Variable Mutation Tracker
 *
 * Helps debug issues where variables are unexpectedly modified.
 * Provides stack traces and validation on mutation.
 *
 * Usage:
 * ```
 * const tracker = new VariableMutationTracker<string>("lineRequestedKeys");
 *
 * tracker.on("mutate", (event) => {
 *   log.warn(`Variable changed: "${event.oldValue}" → "${event.newValue}"`);
 *   if (event.stack) log.debug(`Stack: ${event.stack}`);
 * });
 *
 * // Wrap your variable with a proxy
 * myObject.lineRequestedKeys = tracker.createProxy(
 *   myObject.lineRequestedKeys,
 *   (v) => v.split(",").every(k => isValidKey(k)) // validator
 * );
 * ```
 */

import {EventEmitter} from "events";

export interface MutationEvent<T> {
    oldValue: T;
    newValue: T;
    timestamp: number;
    stack?: string;
    isValid: boolean;
    validationError?: string;
}

export interface MutationHistory<T> {
    timestamp: number;
    oldValue: T;
    newValue: T;
    stack?: string;
}

/**
 * Tracks mutations to a variable and logs them
 */
export class VariableMutationTracker<T> extends EventEmitter {
    private name: string;
    private currentValue: T;
    private history: MutationHistory<T>[] = [];
    private validator?: (value: T) => boolean | {valid: boolean; error?: string};
    private maxHistorySize: number = 100;
    private captureStackTrace: boolean = true;
    private stackTraceDepth: number = 5;

    constructor(
        name: string,
        initialValue: T,
        options?: {
            validator?: (value: T) => boolean | {valid: boolean; error?: string};
            captureStackTrace?: boolean;
            stackTraceDepth?: number;
            maxHistorySize?: number;
        }
    ) {
        super();
        this.name = name;
        this.currentValue = initialValue;
        this.validator = options?.validator;
        this.captureStackTrace = options?.captureStackTrace ?? true;
        this.stackTraceDepth = options?.stackTraceDepth ?? 5;
        this.maxHistorySize = options?.maxHistorySize ?? 100;
    }

    /**
     * Track a value change
     */
    public setValue(newValue: T): void {
        const oldValue = this.currentValue;

        if (oldValue === newValue) {
            return; // No change
        }

        // Capture stack trace
        let stack: string | undefined;

        if (this.captureStackTrace) {
            stack = this.getStackTrace();
        }

        // Validate new value
        let isValid = true;
        let validationError: string | undefined;

        if (this.validator) {
            const result = this.validator(newValue);

            if (typeof result === "boolean") {
                isValid = result;
                validationError = result ? undefined : "Validation failed";
            } else {
                isValid = result.valid;
                validationError = result.error;
            }
        }

        // Record in history
        this.history.push({
            timestamp: Date.now(),
            oldValue,
            newValue,
            stack,
        });

        // Keep history size reasonable
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        // Update current value
        this.currentValue = newValue;

        // Emit mutation event
        const event: MutationEvent<T> = {
            oldValue,
            newValue,
            timestamp: Date.now(),
            stack,
            isValid,
            validationError,
        };

        this.emit("mutate", event);

        // Emit validation error if validator failed
        if (!isValid) {
            this.emit("validation-error", event);
        }
    }

    /**
     * Get current value
     */
    public getValue(): T {
        return this.currentValue;
    }

    /**
     * Get mutation history
     */
    public getHistory(): MutationHistory<T>[] {
        return [...this.history];
    }

    /**
     * Get history as formatted string for logging
     */
    public getHistoryFormatted(): string {
        return this.history
            .map((entry, idx) => {
                const timestamp = new Date(entry.timestamp).toISOString();
                return `[${idx}] ${timestamp}\n  Old: ${JSON.stringify(
                    entry.oldValue
                )}\n  New: ${JSON.stringify(entry.newValue)}${
                    entry.stack ? `\n  Stack: ${entry.stack}` : ""
                }`;
            })
            .join("\n\n");
    }

    /**
     * Clear history
     */
    public clearHistory(): void {
        this.history = [];
    }

    /**
     * Get stack trace as formatted string
     */
    private getStackTrace(): string {
        const stack = new Error().stack;
        if (!stack) return "";

        return stack
            .split("\n")
            .slice(2, 2 + this.stackTraceDepth)
            .map((line) => line.trim())
            .join(" <- ");
    }

    /**
     * Create a proxy object that tracks mutations
     * Useful for tracking object properties
     */
    public createPropertyProxy<O extends Record<string, any>>(
        target: O,
        property: string,
        validator?: (value: any) => boolean | {valid: boolean; error?: string}
    ): O {
        const tracker = this;

        return new Proxy(target, {
            get(obj, prop) {
                let value: unknown;

                if (prop === property) {
                    value = tracker.currentValue;
                } else {
                    value = Reflect.get(obj, prop);
                }

                return value as O[Extract<keyof O, string>];
            },

            set(obj, prop, value) {
                if (prop === property) {
                    tracker.setValue(value);
                    return true;
                }

                return Reflect.set(obj, prop, value);
            },
        }) as O;
    }

    /**
     * Get a summary of mutations for debugging
     */
    public getSummary(): string {
        return `
Variable: ${this.name}
Current value: ${JSON.stringify(this.currentValue)}
Total mutations: ${this.history.length}
Max history size: ${this.maxHistorySize}
Capture stack traces: ${this.captureStackTrace}
Validator enabled: ${this.validator ? "yes" : "no"}

Recent mutations (last 5):
${this.history
    .slice(-5)
    .map((h, i) => `  ${i}: "${JSON.stringify(h.oldValue)}" → "${JSON.stringify(h.newValue)}"`)
    .join("\n")}
        `.trim();
    }
}

/**
 * Track multiple variables at once
 */
export class MultiVariableTracker extends EventEmitter {
    private trackers: Map<string, VariableMutationTracker<any>> = new Map();

    public track<T>(
        name: string,
        initialValue: T,
        validator?: (value: T) => boolean | {valid: boolean; error?: string}
    ): VariableMutationTracker<T> {
        const tracker = new VariableMutationTracker(name, initialValue, {validator});

        tracker.on("mutate", (event) => {
            this.emit("mutate", {variable: name, ...event});
        });

        tracker.on("validation-error", (event) => {
            this.emit("validation-error", {variable: name, ...event});
        });

        this.trackers.set(name, tracker);
        return tracker;
    }

    public getTracker<T>(name: string): VariableMutationTracker<T> | undefined {
        return this.trackers.get(name) as VariableMutationTracker<T> | undefined;
    }

    public getSummaryAll(): string {
        const lines = [
            "=== Multi-Variable Mutation Tracker Summary ===",
            `Total tracked variables: ${this.trackers.size}`,
            "",
        ];

        for (const [name, tracker] of this.trackers) {
            lines.push(`${name}:`);
            lines.push(`  Current: ${JSON.stringify(tracker.getValue())}`);
            lines.push(`  Mutations: ${tracker.getHistory().length}`);
        }

        return lines.join("\n");
    }
}
