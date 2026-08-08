import { Chat } from "./chat.js";

export default function Page(): React.ReactElement {
  return (
    <main>
      <header className="masthead">
        <h1>langchain-sandbox</h1>
        <p>An agent that shows its work — every Tool Call, as it happens.</p>
      </header>
      <Chat />
    </main>
  );
}
