import { useEffect, useState } from "react";
import {
    getToyConfig,
    getToySchema,
    setToyConfig,
    type ToyControl,
    type ToyControlSchema,
} from "../hooks/useIpc";

interface Props {
    packageName: string;
}

export function ToyControlPanel({ packageName }: Props) {
    const [schema, setSchema] = useState<ToyControlSchema | null>(null);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [status, setStatus] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void (async () => {
            setLoading(true);
            setError("");
            const [schemaResult, saved] = await Promise.all([
                getToySchema(packageName),
                getToyConfig(packageName),
            ]);
            if (!schemaResult.success) {
                setError(schemaResult.error ?? "Could not load control schema.");
                setLoading(false);
                return;
            }
            const s = schemaResult.schema ?? null;
            setSchema(s);
            // Seed any unset fields with their defaults so first render is meaningful.
            const initial: Record<string, unknown> = { ...saved };
            for (const control of s ?? []) {
                if (initial[control.id] === undefined) initial[control.id] = control.default;
            }
            setValues(initial);
            setLoading(false);
        })();
    }, [packageName]);

    const handleChange = async (control: ToyControl, next: unknown) => {
        const merged = { ...values, [control.id]: next };
        setValues(merged);
        const result = await setToyConfig(packageName, merged, schema);
        if (result.success) {
            setStatus("Saved");
            setTimeout(() => setStatus(""), 1500);
        } else {
            setError(result.error ?? "Failed to save");
            setTimeout(() => setError(""), 4000);
        }
    };

    if (loading) return <div className="toy-controls">Loading controls...</div>;
    if (error) return <div className="toy-controls toy-controls-error">{error}</div>;
    if (!schema || schema.length === 0) {
        return <div className="toy-controls-empty">This plugin has no settings.</div>;
    }

    return (
        <div className="toy-controls">
            {schema.map((control) => (
                <ControlField
                    key={control.id}
                    control={control}
                    value={values[control.id]}
                    onChange={(v) => void handleChange(control, v)}
                />
            ))}
            {status && <div className="toy-controls-status">{status}</div>}
        </div>
    );
}

interface FieldProps {
    control: ToyControl;
    value: unknown;
    onChange: (v: unknown) => void;
}

function ControlField({ control, value, onChange }: FieldProps) {
    return (
        <div className="toy-control">
            <label className="toy-control-label">
                <span className="toy-control-title">{control.label}</span>
                {control.description && (
                    <span className="toy-control-description">{control.description}</span>
                )}
                {renderInput(control, value, onChange)}
            </label>
        </div>
    );
}

function renderInput(control: ToyControl, value: unknown, onChange: (v: unknown) => void) {
    switch (control.type) {
        case "slider": {
            const v = typeof value === "number" ? value : control.default;
            const display = control.valueLabels?.[v] ?? String(v);
            return (
                <div className="toy-control-slider">
                    <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step ?? 1}
                        value={v}
                        onChange={(e) => onChange(Number(e.target.value))}
                    />
                    <span className="toy-control-slider-value">{display}</span>
                </div>
            );
        }
        case "select": {
            const v = value ?? control.default;
            return (
                <select
                    value={String(v)}
                    onChange={(e) => {
                        const chosen = control.options.find((o) => String(o.value) === e.target.value);
                        if (chosen) onChange(chosen.value);
                    }}
                >
                    {control.options.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            );
        }
        case "toggle": {
            const v = typeof value === "boolean" ? value : control.default;
            return (
                <input
                    type="checkbox"
                    checked={v}
                    onChange={(e) => onChange(e.target.checked)}
                />
            );
        }
    }
}
