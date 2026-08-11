export type OpenArtMediaType = "image" | "video" | "audio";

export type OpenArtMode =
  | "text2image"
  | "image2image"
  | "text2video"
  | "image2video"
  | "element2video"
  | string;

export interface OpenArtModeInfo {
  mode: OpenArtMode;
  description?: string;
  elementTypes?: OpenArtMediaType[];
}

export interface OpenArtModel {
  id: string;
  displayName: string;
  description?: string;
  modes: Partial<Record<OpenArtMediaType, OpenArtModeInfo[]>>;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

export interface OpenArtModelForm {
  model: string;
  mode: string;
  media: OpenArtMediaType;
  jsonSchema: JsonSchema;
  defaults?: Record<string, unknown>;
}
