import { createGenerationRuntime, type PipelineDeps } from "@vita/core";

export type ModelsRuntime = Pick<PipelineDeps["runtime"], "getModels" | "getAvailable" | "getError">;
export type RuntimeFactory = () => Promise<{ runtime: ModelsRuntime; close: () => Promise<void> }>;

export async function listModels(runtime: ModelsRuntime) {
  const available = new Set(
    (await runtime.getAvailable(undefined, { signal: AbortSignal.timeout(10_000) })).map(
      (model) => `${model.provider}/${model.id}`,
    ),
  );
  const error = runtime.getError();
  if (error) throw new Error(error);
  return runtime
    .getModels()
    .map((model) => {
      const id = `${model.provider}/${model.id}`;
      return { id, hasCredentials: available.has(id) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function modelsCommand(
  options: { available?: boolean } = {},
  factory: RuntimeFactory = createGenerationRuntime,
  print: (line: string) => void = console.log,
): Promise<void> {
  const created = await factory();
  try {
    const models = await listModels(created.runtime);
    for (const model of models.filter((model) => !options.available || model.hasCredentials))
      print(`${model.id}${model.hasCredentials ? " [credentials]" : ""}`);
    if (!models.some((model) => model.hasCredentials)) print("No models with credentials. Run `pnpm vita login`.");
  } finally {
    await created.close();
  }
}
