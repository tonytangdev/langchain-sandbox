/**
 * The browser's conversation, read back as domain Messages.
 *
 * The chat client holds the whole history and posts it with every question, in the AI SDK's
 * `UIMessage` shape — a render tree of parts, not a transcript. The Agent Loop takes
 * `Message`s. This file is the seam, hand-written on purpose: the contract with the SDK is
 * its UI message type in and its stream chunks out, so nothing here needs the SDK's own
 * model-message types and the domain `Message` stays untouched.
 */
import type { UIMessage } from "ai";
import type { Message } from "../domain/types.js";

/**
 * Flatten a UI history into the conversation to seed a run with.
 *
 * Deliberately lossy: only the text is carried across, and the Tool Calls and tool results
 * already on screen are dropped. Reconstructing them would produce an *invalid* conversation
 * more often than a useful one — a provider rejects an assistant message whose Tool Call has
 * no matching result, and the UI history is full of calls with no result: a tool that failed
 * has an error where its result would be, and a run the user stopped has nothing at all.
 *
 * What survives is what the conversation is actually about — what was asked and what was
 * answered — which is what a follow-up question needs. The tool traffic of an earlier turn is
 * evidence for the reader, not context for the next question.
 */
export function conversationFromUIMessages(messages: readonly UIMessage[]): Message[] {
  const conversation: Message[] = [];

  for (const message of messages) {
    // The system prompt belongs to the Workflow, not to whoever is talking. A client that
    // sends one is trying to reconfigure the agent, and is ignored rather than obeyed.
    if (message.role === "system") continue;

    const content = textOf(message);
    // An assistant message that was nothing but Tool Calls flattens to nothing. Empty
    // messages are rejected by some providers and mean nothing to any of them, so drop it.
    if (content === "") continue;

    conversation.push(
      message.role === "user"
        ? { role: "user", content }
        : // No tool calls, for the reason above: they would have no results to match.
          { role: "assistant", content, toolCalls: [] },
    );
  }

  return conversation;
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}
