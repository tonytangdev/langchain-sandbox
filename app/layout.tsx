import type { Metadata } from "next";
import type { ReactNode } from "react";

import "streamdown/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "langchain-sandbox",
  description: "A one-shot tool-calling agent that shows its work.",
};

export default function RootLayout({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
