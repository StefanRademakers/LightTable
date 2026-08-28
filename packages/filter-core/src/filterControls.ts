export interface NumberFilterControl {
  readonly type: "number";
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: "px" | "%" | "deg";
}

export interface SelectFilterControl {
  readonly type: "select";
  readonly key: string;
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

export interface AssetFilterControl {
  readonly type: "asset";
  readonly key: string;
  readonly label: string;
  readonly acceptedKinds: readonly ["raster"];
}

export type FilterControlDefinition =
  NumberFilterControl | SelectFilterControl | AssetFilterControl;

export const numberFilterControl = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: NumberFilterControl["unit"],
): NumberFilterControl => ({
  type: "number",
  key,
  label,
  min,
  max,
  step,
  ...(unit ? { unit } : {}),
});

export const selectFilterControl = (
  key: string,
  label: string,
  options: readonly { readonly value: string; readonly label: string }[],
): SelectFilterControl => ({ type: "select", key, label, options });
