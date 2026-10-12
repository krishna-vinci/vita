import type { AvailableModelsView } from "@vita/shared";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A searchable list of the models you can use, grouped by provider, with "Custom…" for anything else.
 * `value` undefined means "use the default" (roles only).
 */
export function ModelPicker({
  id,
  label,
  value,
  onChange,
  models,
  allowDefault = false,
  disabled,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  models: AvailableModelsView["models"];
  allowDefault?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const known = value !== undefined && models.some((model) => model.id === value);
  const showCustom = custom || (value !== undefined && !known);
  const providers = [...new Set(models.map((model) => model.provider))];
  const choose = (next: string | undefined) => {
    onChange(next);
    setCustom(false);
    setOpen(false);
  };
  const shown = value === undefined ? (allowDefault ? "Use default model" : "Choose a model") : value || "Custom…";
  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            disabled={disabled}
            className="h-11 w-full justify-between font-normal"
          >
            <span className="truncate">{shown}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models…" />
            <CommandList>
              <CommandEmpty>No models match. Choose Custom… to type one.</CommandEmpty>
              {allowDefault && (
                <CommandGroup>
                  <CommandItem value="use default model" onSelect={() => choose(undefined)}>
                    <Check className={cn("size-4", value === undefined ? "opacity-100" : "opacity-0")} />
                    Use default model
                  </CommandItem>
                </CommandGroup>
              )}
              {providers.map((provider) => (
                <CommandGroup key={provider} heading={provider}>
                  {models
                    .filter((model) => model.provider === provider)
                    .map((model) => (
                      <CommandItem
                        key={model.id}
                        value={`${model.provider} ${model.name} ${model.id}`}
                        onSelect={() => choose(model.id)}
                      >
                        <Check className={cn("size-4 shrink-0", value === model.id ? "opacity-100" : "opacity-0")} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{model.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{model.id}</span>
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
              <CommandGroup>
                <CommandItem
                  value="custom type an id"
                  onSelect={() => {
                    setCustom(true);
                    onChange(value ?? "");
                    setOpen(false);
                  }}
                >
                  Custom…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {showCustom && (
        <Input
          id={`custom-${id}`}
          aria-label={`${label} model ID`}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="provider/model"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
        />
      )}
    </div>
  );
}
