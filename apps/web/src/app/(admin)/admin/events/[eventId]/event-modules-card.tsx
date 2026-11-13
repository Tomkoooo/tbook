"use client";

import { useActionState, useState, useTransition } from "react";
import { Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormField, NativeSelect, ResultNotice } from "@/components/form-bits";
import { SectionCard } from "@/components/section-card";
import { saveEventModuleConfigAction, setEventModuleAction, type ModuleActionResult } from "../../module-actions";

export interface EventModuleRow {
  key: string;
  name: string;
  description: string;
  on: boolean;
  configFields: Array<{ key: string; label: string; type: "text" | "url" | "select"; hint?: string; options?: Array<{ value: string; label: string }>; deprecated?: string }>;
  config: Record<string, string>;
}

/**
 * The feature modules this organization has been granted, switchable for
 * this event. A module's settings are declared by the module itself and
 * rendered here generically.
 */
export function EventModulesCard({ eventId, modules, canManage }: { eventId: string; modules: EventModuleRow[]; canManage: boolean }) {
  const [result, setResult] = useState<ModuleActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <SectionCard title="Modules" description="Extra features granted to your organization. Switch on what this event uses.">
      <div className="grid gap-3">
        <ResultNotice result={result} />
        {modules.map((module) => (
          <div key={module.key} className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <Puzzle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {module.name}
                  {module.on ? <Badge variant="success">on</Badge> : null}
                </div>
                <p className="text-muted-foreground text-xs">{module.description}</p>
              </div>
              <Switch
                aria-label={`${module.name} for this event`}
                checked={module.on}
                disabled={!canManage || pending}
                onCheckedChange={(enabled) => startTransition(async () => setResult(await setEventModuleAction(eventId, module.key, enabled)))}
              />
            </div>
            {module.on && module.configFields.length > 0 ? <ModuleConfigForm eventId={eventId} module={module} disabled={!canManage} /> : null}
          </div>
        ))}
        {!canManage ? <p className="text-muted-foreground text-xs">Changing modules needs the “Manage modules” permission.</p> : null}
      </div>
    </SectionCard>
  );
}

function ModuleConfigForm({ eventId, module, disabled }: { eventId: string; module: EventModuleRow; disabled: boolean }) {
  const [state, action, pending] = useActionState(
    async (_prev: ModuleActionResult | null, formData: FormData) => saveEventModuleConfigAction(eventId, module.key, formData),
    null,
  );
  return (
    <form action={action} className="grid gap-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* A deprecated field shows only while it still holds a value (kept working as a fallback). */}
        {module.configFields.filter((field) => !field.deprecated || module.config[field.key]).map((field) => (
          <FormField
            key={field.key}
            label={field.deprecated ? `${field.label} (deprecated)` : field.label}
            htmlFor={`${module.key}-${field.key}`}
            hint={field.deprecated ? `${field.deprecated} Clear it to hide it.` : field.hint}
          >
            {field.type === "select" ? (
              <NativeSelect id={`${module.key}-${field.key}`} name={field.key} defaultValue={module.config[field.key] ?? ""} disabled={disabled}>
                <option value="">Default</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={`${module.key}-${field.key}`}
                name={field.key}
                type={field.type === "url" ? "url" : "text"}
                defaultValue={module.config[field.key] ?? ""}
                disabled={disabled}
              />
            )}
          </FormField>
        ))}
      </div>
      <ResultNotice result={state} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={disabled || pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
