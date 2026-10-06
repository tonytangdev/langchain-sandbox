# Context

Ubiquitous language for this repo. Glossary only — no implementation detail, no decisions.
Decisions belong in `docs/adr/`.

## Agent

A **Model** given a set of **Tools** and driven in a loop until it produces an answer with
no further **Tool Calls**. An agent is not a single request to a model; the loop is the
defining property.

## Model

The language model that receives a conversation and returns a **Turn**. Distinct from the
**Provider**, which is the service the model is reached through — the same model may be
available from several providers.

## Provider

The service endpoint a **Model** is reached through, holding the credential and deciding
billing, rate limits, and available model ids.

## Tool

A named, described, schema-typed function the **Model** may ask to have run. A tool is a
declaration (name, description, parameter schema) paired with an implementation. The model
never runs a tool; it only requests one.

## Tool Call

The **Model**'s request to run one **Tool** with concrete arguments. Appears in an assistant
**Turn**. Not a result — the corresponding result is a separate message.

## Client Tool

A **Tool** whose implementation runs in our own process. The **Tool Call** reaches us, we
execute it, and we send the result back. Visible and debuggable end to end.

## Server Tool

A **Tool** the **Provider** executes on its own infrastructure, inside the same request.
No **Tool Call** reaches us and we return no result — the **Model** sees the output
directly. Cheaper to adopt and impossible to observe.

## Message

One entry in the conversation sent to the **Model**: the question asked, an assistant **Turn**,
or the result of one **Tool Call**. A **Turn** becomes a message; a tool result is its own
separate message quoting the id of the call it answers.

## Turn

One model response. May contain answer text, one or more **Tool Calls**, or both. A **Turn**
is a single exchange with the model; an **Agent** is many turns.

## Agent Loop

The cycle of: send conversation to **Model** → receive **Turn** → run any **Tool Calls** →
append their results to the conversation → repeat, until a turn contains no tool calls.
Whichever component owns this loop owns the agent.

## Workflow

A named bundle of a system prompt, a **Model**, and a set of **Tools**, chosen before a
conversation begins. A workflow decides what the agent can do, not what it is asked — a tool
the workflow does not name is never offered to the model, so a missing capability is an
absence rather than an instruction. Every workflow drives one **Agent** today.

## Spike

Throwaway code written to understand something, deliberately unstructured, deleted once
the understanding is had. Contrast **Skeleton**.

## Skeleton

Deliberately-structured code intended to be grown into something real. Layering,
testability, and error handling are in scope for a skeleton and out of scope for a **Spike**.
