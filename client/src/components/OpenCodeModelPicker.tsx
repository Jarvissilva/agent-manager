import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  openCodeProviderModel,
  openCodeSelection,
} from '../lib/opencodeModels';
import type { ProviderModel } from '../types/chat';

export default function OpenCodeModelPicker({
  models,
  value,
  onChange,
  disabled = false,
  id,
}: {
  models: ProviderModel[];
  value: string | null;
  onChange: (model: string | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { providerId, providers, choices } = openCodeSelection(models, value);
  const unavailable = Boolean(
    value && !models.some((model) => model.model === value),
  );
  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  );
  const selectedModel = choices.find((model) => model.model === value);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="ghost"
            aria-label="OpenCode provider"
            disabled={disabled || !models.length}
            className="h-8 min-w-0 gap-1 rounded-full px-2.5 text-xs"
          >
            <span className="max-w-36 truncate sm:max-w-52">
              {selectedProvider?.name ??
                (providerId
                  ? `${providerId} (unavailable)`
                  : 'OpenCode default')}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="max-h-80 w-64">
          <DropdownMenuLabel>Choose a provider</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={providerId}
            onValueChange={(provider) =>
              onChange(openCodeProviderModel(models, provider))
            }
          >
            <DropdownMenuRadioItem value="">
              OpenCode default
            </DropdownMenuRadioItem>
            {providerId && !selectedProvider && (
              <DropdownMenuRadioItem value={providerId} disabled>
                {providerId} (unavailable)
              </DropdownMenuRadioItem>
            )}
            {providers.map((provider) => (
              <DropdownMenuRadioItem key={provider.id} value={provider.id}>
                {provider.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {providerId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="OpenCode model"
              disabled={disabled || !choices.length}
              className="h-8 min-w-0 gap-1 rounded-full px-2.5 text-xs"
            >
              <span className="max-w-36 truncate sm:max-w-52">
                {selectedModel?.displayName ?? `${value} (unavailable)`}
              </span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="max-h-80 w-64"
          >
            <DropdownMenuLabel>Choose a model</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value ?? ''}
              onValueChange={onChange}
            >
              {unavailable && (
                <DropdownMenuRadioItem value={value ?? ''} disabled>
                  {value} (unavailable)
                </DropdownMenuRadioItem>
              )}
              {choices.map((model) => (
                <DropdownMenuRadioItem key={model.id} value={model.model}>
                  <div className="min-w-0">
                    <p className="truncate">{model.displayName}</p>
                    {model.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {model.description}
                      </p>
                    )}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!models.length && (
        <span role="status" className="text-xs text-muted-foreground">
          No usable OpenCode models. Connect or enable a provider in OpenCode,
          then refresh.
        </span>
      )}
    </div>
  );
}
