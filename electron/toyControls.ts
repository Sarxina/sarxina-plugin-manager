/**
 * Generic per-toy configuration framework.
 *
 * Each toy can (optionally) export a `getControlSchema(ctx)` function that
 * returns a list of controls. The launcher renders those controls in the
 * Plugins panel, persists their values in `AppConfig.toyConfigs`, and hands
 * the resolved values to the toy via `ctx.config` at `startToy()` time.
 *
 * While a toy is running, value changes are pushed to it via its optional
 * `ToyHandle.onConfigChange` callback so field semantics like "apply
 * immediately" can be honoured without restarting the toy.
 */

export interface ControlBase {
    /** Key written into the toy's config bag. */
    readonly id: string;
    readonly label: string;
    readonly description?: string;
}

export interface SliderControl extends ControlBase {
    readonly type: "slider";
    readonly min: number;
    readonly max: number;
    readonly step?: number;
    readonly default: number;
    /**
     * Optional per-stop labels. When provided, the value display next to the
     * slider shows the mapped string instead of the raw number — useful for
     * discrete sliders ("Level 1 — 37 parts", "Slow"/"Medium"/"Fast", …).
     */
    readonly valueLabels?: Readonly<Record<number, string>>;
}

export interface SelectControl extends ControlBase {
    readonly type: "select";
    readonly options: ReadonlyArray<{ readonly value: string | number; readonly label: string }>;
    readonly default: string | number;
}

export interface ToggleControl extends ControlBase {
    readonly type: "toggle";
    readonly default: boolean;
}

export type ToyControl = SliderControl | SelectControl | ToggleControl;
export type ToyControlSchema = readonly ToyControl[];

/**
 * Apply a schema's defaults on top of the caller-supplied values. Any value
 * missing from `values` falls back to its control's `default`. Values whose
 * key isn't in the schema are passed through untouched (useful for migration).
 */
export function resolveToyConfig(
    schema: ToyControlSchema,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...values };
    for (const control of schema) {
        if (out[control.id] === undefined) {
            out[control.id] = control.default;
        }
    }
    return out;
}
