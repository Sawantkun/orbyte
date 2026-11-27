"use client";

import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, PROVIDERS, findModel, modelsFor } from "@/config/ai-models";
import {
  ASPECT_RATIOS,
  CONDITION_OPERATORS,
  HTTP_METHODS,
  IMAGE_QUALITIES,
  INPUT_FIELD_TYPES,
  OUTPUT_FORMATS,
  TRANSFORM_OPERATIONS,
  type NodeType,
} from "@/lib/workflow/schema";
import type { ValidationIssue } from "@/lib/workflow/validate";
import { KeyValueInput, NumberInput, SelectInput, SwitchInput, TemplateInput, TextInput } from "./fields";
import { PromptLibrary } from "./prompt-library";
import { useCollections } from "./use-collections";

type Config = Record<string, unknown>;
type Props = {
  type: NodeType;
  config: Config;
  onChange: (patch: Config) => void;
  references: { ref: string; label: string }[];
  issues: ValidationIssue[];
};

const opts = <T extends string>(values: readonly T[], label: (v: T) => string = (v) => v) => values.map((v) => ({ value: v, label: label(v) }));
const human = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const kv = (v: unknown) => (Array.isArray(v) ? (v as { key: string; value: string }[]) : []);

const TRANSFORM_HELP: Record<string, { argument?: string; hint: string }> = {
  template: { hint: "Outputs the input text with {{variables}} filled in." },
  trim: { hint: "Removes leading and trailing whitespace." },
  uppercase: { hint: "Converts text to upper case." },
  lowercase: { hint: "Converts text to lower case." },
  truncate: { argument: "Max length", hint: "Cuts text to a maximum number of characters." },
  replace: { argument: "Find", hint: "Replaces every occurrence of the text to find." },
  split: { argument: "Separator", hint: "Splits text into a list (default: new line)." },
  join: { argument: "Separator", hint: "Joins a list into text (default: new line)." },
  json_parse: { hint: "Parses JSON text into structured data." },
  json_stringify: { hint: "Serialises data as JSON text." },
  json_get: { argument: "Path", hint: "Reads a value by dotted path, e.g. data.items.0.title" },
};

export function NodeConfigForm({ type, config: c, onChange, references, issues }: Props) {
  const errorFor = (field: string) => issues.find((i) => i.field === field && i.severity === "error")?.message.replace(/^[^:]+: /, "");

  switch (type) {
    case "input":
      return (
        <>
          <TextInput label="Field name" mono value={str(c.fieldName)} onChange={(v) => onChange({ fieldName: v })} error={errorFor("fieldName")} hint={<>Reference it as <code className="font-mono">{`{{${str(c.fieldName) || "name"}}}`}</code></>} />
          <SelectInput label="Type" value={str(c.fieldType) as (typeof INPUT_FIELD_TYPES)[number]} options={opts(INPUT_FIELD_TYPES, human)} onChange={(v) => onChange({ fieldType: v })} />
          <TextInput label="Description" value={str(c.description)} onChange={(v) => onChange({ description: v })} placeholder="Shown to whoever runs the workflow" />
          <TextInput label="Default value" mono value={str(c.defaultValue)} onChange={(v) => onChange({ defaultValue: v })} error={errorFor("defaultValue")} />
          <SwitchInput label="Required" hint="Runs fail fast if this value is missing." checked={c.required !== false} onChange={(v) => onChange({ required: v })} />
        </>
      );

    case "ai_text":
    case "ai_image": {
      const capability = type === "ai_text" ? "text" : "image";
      const provider = str(c.provider);
      const models = modelsFor(provider, capability);
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectInput
              label="Provider"
              value={provider}
              options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => onChange({ provider: v, model: modelsFor(v, capability)[0]?.id ?? "" })}
            />
            <SelectInput
              label="Model"
              value={str(c.model) || (type === "ai_text" ? DEFAULT_TEXT_MODEL.model : DEFAULT_IMAGE_MODEL.model)}
              options={models.filter((m) => !m.legacy || m.id === c.model).map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => onChange({ model: v })}
              error={errorFor("model")}
            />
          </div>
          {type === "ai_text" && (
            <TemplateInput label="System instructions" rows={3} value={str(c.systemPrompt)} onChange={(v) => onChange({ systemPrompt: v })} references={references} placeholder="You are a helpful assistant…" />
          )}
          <TemplateInput label="Prompt" rows={6} value={str(c.prompt)} onChange={(v) => onChange({ prompt: v })} references={references} error={errorFor("prompt")} />
          {type === "ai_text" && (
            <TemplateInput
              label="Image (optional)"
              rows={1}
              value={str(c.image)}
              onChange={(v) => onChange({ image: v })}
              references={references}
              error={errorFor("image")}
              placeholder="{{photo}}"
              hint="An Image input or a generated image for the model to look at."
            />
          )}
          {type === "ai_text" ? (
            <div className="grid grid-cols-2 gap-2">
              {findModel(provider, str(c.model))?.supportsTemperature ? (
                <NumberInput label="Temperature" min={0} max={2} step={0.1} value={num(c.temperature, 0.7)} onChange={(v) => onChange({ temperature: v })} error={errorFor("temperature")} />
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Temperature</div>
                  <p className="text-xs text-muted-foreground">Not used by this model.</p>
                </div>
              )}
              <NumberInput label="Max output tokens" min={1} max={32000} step={1} value={num(c.maxOutputTokens, 1024)} onChange={(v) => onChange({ maxOutputTokens: v })} error={errorFor("maxOutputTokens")} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <SelectInput label="Aspect" value={str(c.aspectRatio) as (typeof ASPECT_RATIOS)[number]} options={opts(ASPECT_RATIOS)} onChange={(v) => onChange({ aspectRatio: v })} />
                <SelectInput label="Quality" value={str(c.quality) as (typeof IMAGE_QUALITIES)[number]} options={opts(IMAGE_QUALITIES, human)} onChange={(v) => onChange({ quality: v })} />
                <NumberInput label="Images" min={1} max={4} step={1} value={num(c.count, 1)} onChange={(v) => onChange({ count: v })} error={errorFor("count")} />
              </div>
              <CollectionPicker value={str(c.collectionId) || null} onChange={(v) => onChange({ collectionId: v })} />
              <p className="text-xs text-muted-foreground">Generated images are always saved to your asset library with their prompt, model and run.</p>
            </>
          )}
        </>
      );
    }

    case "prompt_template":
      return (
        <>
          <TemplateInput
            label="Template"
            rows={8}
            value={str(c.template)}
            onChange={(v) => onChange({ template: v })}
            references={references}
            error={errorFor("template")}
            placeholder="Write a launch post for {{product_name}} aimed at {{target_audience}}."
            hint={<>Output: <code className="font-mono">text</code> — the filled-in prompt.</>}
          />
          <PromptLibrary template={str(c.template)} onLoad={(t) => onChange({ template: t.content, templateId: t.id })} />
        </>
      );

    case "condition":
      return (
        <>
          <TemplateInput label="Value to check" rows={2} value={str(c.left)} onChange={(v) => onChange({ left: v })} references={references} error={errorFor("left")} />
          <SelectInput label="Operator" value={str(c.operator) as (typeof CONDITION_OPERATORS)[number]} options={opts(CONDITION_OPERATORS, human)} onChange={(v) => onChange({ operator: v })} />
          {c.operator !== "exists" && <TemplateInput label="Compare with" rows={2} value={str(c.right)} onChange={(v) => onChange({ right: v })} references={references} />}
          <p className="text-xs text-muted-foreground">
            Connect the <span className="text-success">true</span> and <span className="text-destructive">false</span> handles. Nodes only reachable through the untaken branch are skipped.
          </p>
        </>
      );

    case "transform": {
      const op = str(c.operation);
      const help = TRANSFORM_HELP[op];
      return (
        <>
          <SelectInput label="Operation" value={op as (typeof TRANSFORM_OPERATIONS)[number]} options={opts(TRANSFORM_OPERATIONS, human)} onChange={(v) => onChange({ operation: v })} />
          <TemplateInput label="Input" rows={4} value={str(c.input)} onChange={(v) => onChange({ input: v })} references={references} error={errorFor("input")} hint={help?.hint} />
          {help?.argument && <TextInput label={help.argument} mono value={str(c.argument)} onChange={(v) => onChange({ argument: v })} error={errorFor("argument")} />}
          {op === "replace" && <TextInput label="Replace with" mono value={str(c.replacement)} onChange={(v) => onChange({ replacement: v })} />}
        </>
      );
    }

    case "http_request":
      return (
        <>
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <SelectInput label="Method" value={str(c.method) as (typeof HTTP_METHODS)[number]} options={opts(HTTP_METHODS)} onChange={(v) => onChange({ method: v })} />
            <TextInput label="URL" mono value={str(c.url)} onChange={(v) => onChange({ url: v })} error={errorFor("url")} placeholder="https://api.example.com/…" />
          </div>
          <KeyValueInput label="Headers" value={kv(c.headers)} onChange={(v) => onChange({ headers: v })} keyPlaceholder="Header" />
          {c.method !== "GET" && c.method !== "DELETE" && (
            <TemplateInput label="Body" rows={5} value={str(c.body)} onChange={(v) => onChange({ body: v })} references={references} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="Timeout (ms)" min={1000} max={30000} step={500} value={num(c.timeoutMs, 10000)} onChange={(v) => onChange({ timeoutMs: v })} error={errorFor("timeoutMs")} />
            <SelectInput label="Response" value={str(c.responseType) as "json" | "text"} options={opts(["json", "text"] as const, (v) => v.toUpperCase())} onChange={(v) => onChange({ responseType: v })} />
          </div>
          <p className="text-xs text-muted-foreground">Requests to private networks, localhost and cloud metadata endpoints are blocked.</p>
        </>
      );

    case "send_email":
      return (
        <>
          <TemplateInput label="To" rows={1} value={str(c.to)} onChange={(v) => onChange({ to: v })} references={references} error={errorFor("to")} placeholder="someone@example.com, {{recipient}}" hint="Up to 10 addresses, separated by commas." />
          <TemplateInput label="Subject" rows={1} value={str(c.subject)} onChange={(v) => onChange({ subject: v })} references={references} error={errorFor("subject")} />
          <SelectInput label="Format" value={(str(c.format) || "text") as "text" | "html"} options={[{ value: "text", label: "Plain text" }, { value: "html", label: "HTML" }]} onChange={(v) => onChange({ format: v })} />
          <TemplateInput
            label="Body"
            rows={8}
            value={str(c.body)}
            onChange={(v) => onChange({ body: v })}
            references={references}
            error={errorFor("body")}
            placeholder={c.format === "html" ? "<p>Hi!</p><p>{{text_1.text}}</p>" : "{{text_1.text}}"}
            hint={c.format === "html" ? "Sent as HTML with an automatic plain-text version." : undefined}
          />
          <TemplateInput
            label="Attachments (optional)"
            rows={1}
            value={str(c.attachments)}
            onChange={(v) => onChange({ attachments: v })}
            references={references}
            placeholder="{{photo}}"
            hint="Files from your library or generated images. Up to 5 files, 20 MB in total."
          />
          <SwitchInput
            label="Preview only"
            hint={c.preview === false ? "Off: runs send a real email from your connected Gmail." : "On: runs show the email without sending it. Turn off to send."}
            checked={c.preview !== false}
            onChange={(v) => onChange({ preview: v })}
          />
          <p className="text-xs text-muted-foreground">Sends from the Gmail connected in Integrations. Outputs <code className="font-mono">sent</code>, <code className="font-mono">to</code>, <code className="font-mono">subject</code>, <code className="font-mono">body</code>.</p>
        </>
      );

    case "output":
      return (
        <>
          <TextInput label="Output name" mono value={str(c.name)} onChange={(v) => onChange({ name: v })} error={errorFor("name")} />
          <SelectInput label="Format" value={str(c.format) as (typeof OUTPUT_FORMATS)[number]} options={opts(OUTPUT_FORMATS, human)} onChange={(v) => onChange({ format: v })} />
          <TemplateInput label="Value" rows={3} value={str(c.value)} onChange={(v) => onChange({ value: v })} references={references} error={errorFor("value")} />
          <SwitchInput
            label="Save to asset library"
            hint={c.format === "file" ? "Files from upstream nodes (e.g. AI Image) are filed and tagged with this output's metadata." : "Saved as a .txt or .json file with provenance."}
            checked={c.saveToLibrary === true}
            onChange={(v) => onChange({ saveToLibrary: v })}
          />
          {c.saveToLibrary === true && <CollectionPicker value={str(c.collectionId) || null} onChange={(v) => onChange({ collectionId: v })} />}
          <KeyValueInput label="Metadata" value={kv(c.metadata)} onChange={(v) => onChange({ metadata: v })} />
        </>
      );
  }
}

function CollectionPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const collections = useCollections();
  const options = [{ value: "none", label: collections === null ? "Loading…" : "No collection" }, ...(collections ?? []).map((c) => ({ value: c.id, label: c.name }))];
  // Keep an unknown id selectable so the value is not silently dropped (it is re-checked at run time).
  if (value && collections && !collections.some((c) => c.id === value)) options.push({ value, label: "Unavailable collection" });
  return <SelectInput label="Add to collection" value={value ?? "none"} options={options} onChange={(v) => onChange(v === "none" ? null : v)} />;
}
