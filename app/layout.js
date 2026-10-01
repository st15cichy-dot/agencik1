import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.14",
  description: "Autonomous paper research with non-executable shadow execution intents, market expansion and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
