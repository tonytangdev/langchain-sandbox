"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { StickToBottom } from "use-stick-to-bottom";
import { useState, type FormEvent } from "react";

import type { ToolCallOutput } from "@/src/adapters/ui-stream-renderer.js";
import type { Workflow } from "@/src/domain/workflows.js";
import { DEFAULT_WORKFLOW, WORKFLOWS } from "@/src/domain/workflows.js";

/**
 * The whole chat surface: a workflow selector, a transcript and a text box.
 *
 * There is no persistence. `useChat` holds the conversation in React state and posts all of
 * it with every question — which is also the whole of how the agent "remembers" a follow-up —
 * so a reload gives a fresh empty conversation, matching the CLI's one question, one answer.
 *
 * `WORKFLOWS` is imported straight into this client component on purpose: it is the same
 * dependency-free list the CLI and the route read, so what the selector offers cannot drift
 * from what the server will accept. It names a model and names tools; it holds neither, so
 * nothing vendor-shaped is dragged into the bundle by importing it.
 */
export function Chat(): React.ReactElement {
  const { messages, sendMessage, status, error, setMessages, clearError, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const [workflow, setWorkflow] = useState<Workflow>(DEFAULT_WORKFLOW);
  /**
   * Whether the run on screen was stopped by hand.
   *
   * Held here because nothing else can say it. Aborting is a *clean* end to the stream — the
   * transport's abort chunk renders as nothing, `status` goes back to `ready` exactly as it
   * does after a normal answer, and no error arrives. So a transcript that was cut off and one
   * that finished are identical afterwards unless the one thing only this side knows — that
   * the button was pressed — is remembered.
   */
  const [stopped, setStopped] = useState(false);

  const busy = status === "submitted" || status === "streaming";

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = input.trim();
    if (text === "" || busy) return;
    setInput("");
    // The note belongs to the run it interrupted, not to the conversation.
    setStopped(false);
    // The name travels with *this* request, read from state at the moment of asking.
    //
    // The tempting alternative — `new DefaultChatTransport({ api, body: { workflow } })` — is
    // the bug this has to avoid: `useChat` keeps the transport it was given on the first
    // render, so the body would be frozen at whatever was selected when the page mounted and
    // every question after the first switch would run under the old workflow while the UI
    // showed the new one. Per-call `body` cannot go stale, because there is nothing held.
    void sendMessage({ text }, { body: { workflow: workflow.name } });
  }

  /**
   * Halt the run without abandoning it.
   *
   * `stop()` aborts the fetch, which the server sees as the client disconnecting — the same
   * event a closed tab produces, and the reason there is no "cancel" endpoint to call. What
   * has already streamed in stays in the transcript, because it is already in React state.
   */
  function onStop(): void {
    setStopped(true);
    void stop();
  }

  /**
   * Switching workflow starts a new conversation, deliberately rather than conveniently.
   *
   * Keeping the transcript would leave calculate results sitting in the history of an agent
   * that no longer has calculate — the exact state in which a model claims a capability it
   * does not have, producing a bug that is not in our code and cannot be fixed there. The
   * visible reset is also the demo: same question, empty transcript, different behaviour.
   *
   * Mid-run this now stops the run rather than refusing the click. Before there was a stop
   * button the picker had to be disabled while busy, because switching would have left the
   * old workflow's answer streaming into the new workflow's empty transcript; now the honest
   * reading of the click is "I have seen enough of this one", and it is a thing we can do.
   */
  function onSelectWorkflow(next: Workflow): void {
    if (next.name === workflow.name) return;
    // Before clearing, so no chunk of the abandoned run can land in the new transcript.
    if (busy) void stop();
    setWorkflow(next);
    setMessages([]);
    clearError();
    // The interrupted run's transcript is going away with it, so the note has nothing to
    // annotate — saying "stopped" above an empty conversation would be noise.
    setStopped(false);
  }

  return (
    <div className="chat">
      <WorkflowPicker selected={workflow} onSelect={onSelectWorkflow} />

      {/*
        StickToBottom keeps the transcript pinned as chunks arrive, and releases
        the pin the moment the user scrolls up — the one behaviour that is
        genuinely fiddly to hand-roll, hence the dependency.
      */}
      <StickToBottom className="transcript" resize="smooth" initial="instant">
        {/* StickToBottom.Content puts its own scroll element between these two
            divs, so the overflow has to live on `scrollClassName`, not here. */}
        <StickToBottom.Content className="transcript-content" scrollClassName="transcript-scroll">
          {messages.length === 0 ? (
            <p className="empty">
              {`Ask ${workflow.name} something. Every Tool Call it makes shows up here as it happens.`}
            </p>
          ) : (
            // `live` is what stops a Tool Call that was cut off mid-flight from claiming
            // forever that it is still running. See ToolCallView.
            messages.map((message) => <MessageView key={message.id} message={message} live={busy} />)
          )}

          {busy ? <Activity messages={messages} /> : null}

          {/*
            The three ways a run ends without answering, kept visibly apart because they mean
            different things to whoever is reading. "Stopped" is the user's own doing and is
            drawn as a quiet note; a timeout and the iteration cap are the server's, arrive on
            the error channel, and are drawn as errors. Only one can be showing: a stopped run
            never reaches the server's error paths, because the server is talking to nobody.
          */}
          {stopped && !busy ? <p className="run-stopped">Stopped. What arrived before that is above.</p> : null}
          {error ? <p className="run-error">{error.message}</p> : null}
        </StickToBottom.Content>
      </StickToBottom>

      <form className="composer" onSubmit={onSubmit}>
        <input
          name="message"
          value={input}
          autoComplete="off"
          placeholder="Ask the agent something…"
          onChange={(event) => setInput(event.target.value)}
        />
        {/*
          Send and Stop are the same slot, never both, because they are the same question
          asked at the two moments it has an answer: nothing is running, so start one; something
          is running, so end it. A permanently-present Stop would be disabled most of the time,
          and a disabled control that does nothing is worse than an absent one. `type="button"`
          matters — inside a form, a button with no type submits it.
        */}
        {busy ? (
          <button type="button" className="stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={input.trim() === ""}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Which Workflow answers, and what each one can do.
 *
 * A radio group rather than a `<select>`, because the tools have to be readable *before*
 * anything is asked — that is the whole claim the page makes, that `Math` cannot search and
 * you can see so without trying. A dropdown hides two of the three options until opened, and
 * hides the tools entirely.
 *
 * Native radios under labels, so keyboard and screen-reader behaviour is the platform's and
 * not something hand-rolled here; the input itself is visually hidden and the label is drawn
 * as the card.
 */
function WorkflowPicker({
  selected,
  onSelect,
}: {
  selected: Workflow;
  onSelect: (workflow: Workflow) => void;
}): React.ReactElement {
  return (
    <fieldset className="workflows">
      <legend>Workflow — switching starts a new conversation</legend>
      <div className="workflow-list">
        {WORKFLOWS.map((workflow) => (
          <label
            key={workflow.name}
            className={`workflow${workflow.name === selected.name ? " workflow-selected" : ""}`}
          >
            <input
              type="radio"
              name="workflow"
              value={workflow.name}
              checked={workflow.name === selected.name}
              onChange={() => onSelect(workflow)}
            />
            <span className="workflow-name">{workflow.name}</span>
            {/* The capability list, straight off the definition. A workflow's inability to
                search is an absent tool, so an absent chip is the honest way to show it. */}
            <span className="workflow-tools">
              {workflow.toolNames.map((toolName) => (
                <code key={toolName}>{toolName}</code>
              ))}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One message, part by part.
 *
 * The parts arrive in the order the agent produced them, so rendering them in order is
 * already the transcript: turn boundary, what that turn said, what it asked for, what came
 * back, next turn. Nothing here reorders or groups anything.
 */
function MessageView({ message, live }: { message: UIMessage; live: boolean }): React.ReactElement {
  // Turns are numbered for the reader, and the count has to be kept out here because the
  // parts array interleaves boundaries with content.
  let turn = 0;

  return (
    <article className={`message message-${message.role}`}>
      <h2 className="role">{message.role === "user" ? "You" : "Assistant"}</h2>
      {message.parts.map((part, index) => {
        switch (part.type) {
          case "text":
            // Streamdown renders markdown that is still mid-word without flashing
            // raw `**` or half-open code fences at the reader.
            return <Streamdown key={index}>{part.text}</Streamdown>;

          // A `start-step` chunk from the server; one per Turn. Without it a multi-step
          // answer reads as one undifferentiated pile of tool cards.
          case "step-start":
            return <p key={index} className="turn-boundary">{`turn ${turn++}`}</p>;

          // Named at runtime, because the Workflow decides at runtime which tools exist.
          case "dynamic-tool":
            return <ToolCallView key={index} part={part} live={live} />;

          default:
            return null;
        }
      })}
    </article>
  );
}

/**
 * One Tool Call: what the model asked for, and what happened.
 *
 * Three of the four states are the part's own — asked and still running, returned, failed. The
 * fourth needs one bit from outside: a tool that never reported back is *running* only while
 * the run is, and cancelled once it is not.
 *
 * Without that bit, stopping the agent mid-search leaves a card pulsing "running…" over work
 * that was torn down seconds ago — which is precisely the "it looked like it stopped" reading
 * this control exists to avoid. The server cannot tell us, either: on a stop it is talking to a
 * socket that has already gone, so the chunk that would close the card off reaches nobody.
 */
function ToolCallView({ part, live }: { part: DynamicToolUIPart; live: boolean }): React.ReactElement {
  const pending = part.state === "input-streaming" || part.state === "input-available";
  const running = pending && live;
  const cancelled = pending && !live;
  const output = part.state === "output-available" ? (part.output as ToolCallOutput) : undefined;

  return (
    <section className={`tool-call tool-call-${running ? "running" : cancelled ? "cancelled" : part.state}`}>
      <header>
        <span className="tool-name">{part.toolName}</span>
        {running ? <span className="tool-status">running…</span> : null}
        {cancelled ? <span className="tool-status">cancelled — the run stopped before it returned</span> : null}
        {output ? <span className="tool-status">{`${output.durationMs}ms`}</span> : null}
      </header>

      {/* The arguments the model chose, verbatim. Half the reason to watch a tool call is
          seeing what it decided to pass. */}
      <pre className="tool-args">{JSON.stringify(part.input, null, 2)}</pre>

      {output ? <pre className="tool-result">{output.result}</pre> : null}
      {part.state === "output-error" ? <p className="tool-error">{part.errorText}</p> : null}
    </section>
  );
}

/**
 * Which of the three things the run is doing right now.
 *
 * "The model is working" is the absence of the other two: no tool is running and no text has
 * started arriving, so we are waiting on the provider. Reading it off the last part rather
 * than tracking state means it cannot disagree with the transcript above it.
 */
function Activity({ messages }: { messages: readonly UIMessage[] }): React.ReactElement {
  const last = messages[messages.length - 1];
  const parts = last?.role === "assistant" ? last.parts : [];

  const runningTool = parts.find(
    (part) => part.type === "dynamic-tool" && (part.state === "input-available" || part.state === "input-streaming"),
  );
  const lastPart = parts[parts.length - 1];
  const answering = lastPart?.type === "text" && lastPart.state === "streaming";

  const label =
    runningTool !== undefined && runningTool.type === "dynamic-tool"
      ? `${runningTool.toolName} is running…`
      : answering
        ? "the answer is arriving…"
        : "the model is working…";

  return <p className="activity">{label}</p>;
}
