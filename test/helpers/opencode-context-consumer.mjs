// Focused, source-shaped V1 request fixture. SDK transport and model execution
// are substituted. Separate local evidence executes the cached pinned upstream
// Plugin.trigger/request preparation; this helper is not a live SDK/Host proof.
export async function prepareRequest(hooks, sessionID, { system = ["Original system"], messages = [{ role: "user", content: "Original user request" }], oauth = false } = {}) {
  const output = { system: [...system] };
  for (const hook of hooks) await hook["experimental.chat.system.transform"]?.({ sessionID, model: {} }, output);
  return { output, messages: oauth ? messages : [...output.system.map(content => ({ role: "system", content })), ...messages],
    options: oauth ? { instructions: output.system.join("\n") } : {}, originalMessages: messages };
}
