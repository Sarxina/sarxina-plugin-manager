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
    /**
     * Optional conditional visibility. When set, the control is only shown
     * (and its value only applied) when another control's current value
     * equals `showWhen.equals`. Used for option-dependent fields — e.g. a
     * "reward cost" field that only appears when the user picks "redeem"
     * from a "trigger type" select.
     */
    readonly showWhen?: {
        readonly id: string;
        readonly equals: string | number | boolean;
    };
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

export interface RadioControl extends ControlBase {
    readonly type: "radio";
    readonly options: ReadonlyArray<{ readonly value: string | number; readonly label: string }>;
    readonly default: string | number;
}

export interface ToggleControl extends ControlBase {
    readonly type: "toggle";
    readonly default: boolean;
}

export interface NumberInputControl extends ControlBase {
    readonly type: "numberInput";
    readonly default: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    /** Optional placeholder shown when the field is empty. */
    readonly placeholder?: string;
}

export interface TextInputControl extends ControlBase {
    readonly type: "textInput";
    readonly default: string;
    readonly placeholder?: string;
}

export type ToyControl =
    | SliderControl
    | SelectControl
    | RadioControl
    | ToggleControl
    | NumberInputControl
    | TextInputControl;
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
